/**
 * store.js — locating and loading the flat-YAML task store.
 *
 * THE ONLY PLACE THAT KNOWS HOW TO FIND A STORE, and the only place that can
 * say it failed to. Everything else takes a resolved root.
 *
 * ## Why a missing store is an ERROR
 *
 * The tracker's first reader (a loose script, long since replaced by this package)
 * resolved its root from `import.meta.url` — its own location on disk — and, when it
 * found nothing there, printed an empty backlog and exited 0:
 *
 *     $ TASKS_ROOT=/tmp/empty <the-old-reader> --format json
 *     no store found under /tmp/empty …                      <- stderr
 *     { "ready": [], "blocked": [], "needsAttention": [] }   <- stdout
 *     $ echo $?
 *     0
 *
 * stdout carried a well-formed, entirely fictional "you have no work", and the
 * only signal that the tool was lost went to stderr — which ten call sites pipe
 * to /dev/null. An ABSENT store and an EMPTY store were indistinguishable to
 * every consumer.
 *
 * So: **only "I was told to look and found nothing" is an error.** An empty
 * backlog is a legitimate answer; a missing store is a question we cannot answer.
 *
 *   store root not found  -> ENOSTORE, non-zero exit
 *   a store but no tasks/      -> valid empty backlog, exit 0
 *   tasks/ but no tasks-*.yml  -> valid empty backlog, exit 0
 *   tasks-*.yml with `tasks: []` -> valid empty backlog, exit 0
 *
 * This is also what makes the tracker safe to package: once the code lives in
 * `node_modules/diarie/lib/`, an `import.meta.url`-relative root would point at
 * the package's own directory. Under the old contract that bug was invisible
 * (empty store, exit 0, checks green). Under this one it is a hard failure on
 * the first run.
 */

import { readdir, readFile } from 'node:fs/promises';
import {
  existsSync,
} from 'node:fs';
import {
  join, resolve,
} from 'node:path';

import yaml from 'js-yaml';
import {
  isObject, isStringArray, isType, typesafeIsArray,
} from '@voxpelli/typed-utils';

import { NoStoreError } from './store/errors.js';
import { legacyTrackerDirIn, trackerDirIn } from './store/root.js';
import { slugOf } from './store/utils.js';
import {
  isNil, isPriority, isStatus, isTaskType, nsId,
} from './schema.js';

/** @import { GlobalId, Priority, Status, TaskType } from './schema.js' */

/** Matches the task files the store globs. Decisions and docs are deliberately outside it. */
const TASKS_FILE_RE = /^tasks-.+\.ya?ml$/;

/**
 * A task AS LOADED — the post-load, pre-validation shape. Deliberately not "a task the
 * validator has blessed": nothing in this package produces one of those, and pretending
 * otherwise would be the more comfortable lie.
 *
 * So `title` and `type` are optional here even though `REQUIRED_FIELDS` calls them
 * required — because the store must be able to REPRESENT a store that is wrong. That is
 * `validate`'s job to report, and every reader's job to survive. It is also exactly why
 * `computeReady` defends itself with `if (task.type !== 'task') continue` rather than
 * assuming.
 *
 * `deps` is NOT optional: the loader guarantees it (see `safeDeps`).
 *
 * The three id-bearing fields are `GlobalId`, so they cannot be populated with a string
 * that has not been through `nsId`. That is the compile-time half of the fix for the
 * half-globalized `parent` — see schema.js's `GlobalId`.
 *
 * @typedef Task
 * @property {GlobalId} id   globally-unique, namespaced `slug/id`
 * @property {string} [title]
 * @property {Status} status
 * @property {Priority} [priority]
 * @property {TaskType} [type]
 * @property {GlobalId[]} deps  resolvable ids in the same namespace
 * @property {GlobalId} [parent]
 * @property {string[]} [labels]
 * @property {string[]} [acceptance_criteria]
 * @property {string} [agent]
 * @property {string} [updated]   ISO date
 * @property {string} [description]
 */

/**
 * A task as returned by loadTasks — a Task plus loader-only provenance. The
 * provenance fields are internal and stripped before any JSON output.
 *
 * @typedef {Task & { _slug?: string, _file?: string }} LoadedTask
 */

/**
 * Drop the loader-only provenance fields (`_slug`, `_file`) before output.
 *
 * Lives here, in the module that ADDS them — a leak is otherwise inevitable, and it
 * happened: the first cut of `diarie ready --json` emitted `_slug`/`_file` into
 * every consumer's parsed output because the stripping lived in the old reader's
 * private scope and the new command simply forgot. The thing that creates a mess
 * should own cleaning it up.
 *
 * @param {LoadedTask} t
 * @returns {Task}
 */
export const loadedTaskToTask = ({ _file, _slug, ...task }) => task;

/**
 * Coerce a YAML `deps` value to a safe namespaced GlobalId[]: an array → namespace
 * each entry; nil → []; any other shape → [] plus a warning (the validator owns
 * the hard error — this just keeps the reader from crashing).
 *
 * @param {unknown} raw
 * @param {string} slug
 * @param {string} file
 * @param {string} taskId
 * @param {(msg: string) => void} warn
 * @returns {GlobalId[]}
 */
function safeDeps (raw, slug, file, taskId, warn) {
  if (isNil(raw)) {
    return [];
  }

  if (!typesafeIsArray(raw)) {
    warn(`${file}: task ${taskId}: "deps" is not a list — treating as empty (run \`diarie validate\`)`);
    return [];
  }

  return raw.map(d => nsId(d, slug));
}

/**
 * Build the "this field was rejected" reporter for one task.
 *
 * A guard that DROPS a value and a guard that REPORTS it are different guards, and treating
 * them as one is how the loader's own type-safety produced three silent bugs at once.
 *
 * @param {(msg: string) => void} warn
 * @param {string} file
 * @param {string} id
 * @returns {(field: string, value: unknown, consequence: string) => void}
 */
const rejecter = (warn, file, id) => (field, value, consequence) => {
  warn(`${file}: task ${id}: invalid ${field} ${JSON.stringify(value)} — ${consequence} (run \`diarie validate\`)`);
};

/**
 * List the `tasks-<slug>.yml` files under a resolved root.
 *
 * An absent `tasks/` dir is an EMPTY store, not a missing one — but an absent STORE is
 * missing, and this function must say so rather than return an empty list.
 *
 * That distinction used to be free: the store directory was a constant, so `resolveRoot`
 * having proven the root was the whole guarantee. With the pair it is re-derived here, which
 * makes this function partial — and it is a PUBLIC export, so nothing stops a consumer
 * calling it on a root that was never resolved. Returning `{names: []}` for one would print
 * a clean empty backlog for a project whose store was never found: this package's founding
 * defect, reintroduced through the one function that stopped being total.
 *
 * @param {string} root
 * @returns {Promise<{ tasksDir: string, names: string[], ignored: string[] }>}
 * @throws {NoStoreError} when `root` holds no store (it was not resolved by `resolveRoot`)
 * @throws {TwoStoresError} when it holds both
 */
export async function listTaskFiles (root) {
  // RESOLVE FIRST, then look. `NoStoreError`'s legacy branch spells out a `git mv` with the
  // legacy path on one side and `from` on the other, and it is only pasteable if BOTH are
  // absolute — this is a public export, so `root` may well arrive relative.
  const from = resolve(root);
  const store = trackerDirIn(from);

  if (!store) {
    throw new NoStoreError(from, false, legacyTrackerDirIn(from)?.path);
  }

  const tasksDir = join(store.path, 'tasks');
  // `existsSync`, NOT the `isDirectory` check `trackerDirIn` uses, and the asymmetry is
  // deliberate. There, a non-directory must not pass as a store — passing means a confident
  // empty backlog. Here, an absent `tasks/` is already a legal empty store, so tightening this
  // to `isDirectory` would make a FILE named `tasks` return `{names: []}` — silently empty,
  // from a store that is plainly broken. As written, `readdir` throws ENOTDIR and the failure
  // is loud. Same one-word change; opposite consequence, because the fallthrough differs.
  const entries = existsSync(tasksDir) ? await readdir(tasksDir) : [];

  return {
    tasksDir,
    names: entries.filter(f => TASKS_FILE_RE.test(f)),
    // A dir of non-matching files is not the same as an empty substrate —
    // callers surface this rather than skip it silently.
    ignored: entries.filter(f => !f.startsWith('.') && !TASKS_FILE_RE.test(f)),
  };
}

/**
 * Load and globalize every task under a resolved root. Bare dep ids are
 * namespaced to their file's slug; `slug/id` deps pass through.
 *
 * @param {string} root
 * @param {(msg: string) => void} [warn]
 * @returns {Promise<LoadedTask[]>}
 */
export async function loadTasks (root, warn = () => {}) {
  const { names, tasksDir } = await listTaskFiles(root);
  /** @type {LoadedTask[]} */
  const all = [];

  for (const file of names) {
    const slug = slugOf(file);

    // AN UNPARSEABLE FILE MUST NOT DELETE THE STORE. `yaml.load` throws on malformed YAML, and this
    // call had no guard — so ONE bad file (a stray unterminated quote) blew the whole read up, landed
    // in cli.js's "genuinely unexpected: a bug, not a user mistake" branch, and exited 1 with a stack
    // trace. Every OTHER file's rows went with it, including live in-progress claims in files that
    // were perfectly fine.
    //
    // And exit 1 is a code an automated caller reads as "no store here" and blanks its payload for —
    // so a consuming tool's session-start hook silently forgot a live in-progress claim, on the very
    // path this was all supposed to fix. The founding defect, through a fourth door.
    //
    // Warn-and-skip instead. That routes a bad file into the SAME machinery a bad row already uses:
    // it becomes a loader warning → `unsound` → `--strict` exits 2 → the session prime announces it.
    // `validate` remains the authority that rejects (it already reports `invalid YAML` and exits 2);
    // the reader's job is to be honest and keep going. Represent the malformed input; never delete it.
    /** @type {unknown} */
    let doc;
    try {
      doc = yaml.load(await readFile(join(tasksDir, file), 'utf8'));
    } catch (err) {
      warn(`${file}: invalid YAML — the whole file is skipped, so any rows in it are MISSING from every count (run \`diarie validate\`): ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`);
      continue;
    }

    const list = isObject(doc) ? doc['tasks'] : undefined;
    if (!isNil(list) && !Array.isArray(list)) {
      warn(`${file}: "tasks" is not a list — skipping file (run \`diarie validate\`)`);
      continue;
    }
    for (const t of /** @type {unknown[]} */ (list ?? [])) {
      // `isObject` narrows `unknown` → `Record<string, unknown>`, so every field below is
      // read through a guard rather than asserted. This used to be a `{ ...t }` spread of
      // an `any`, which made the WHOLE object literal `any` — `LoadedTask[]` accepted it
      // unconditionally, so `loadTasks(): Promise<LoadedTask[]>` was a promise the compiler
      // never checked. (`{...raw, id: 42, nonsense: true}` type-checked clean. Verified.)
      if (!isObject(t) || isNil(t['id'])) {
        warn(`${file}: a task entry has no id — skipping it (run \`diarie validate\`)`);
        continue;
      }
      const raw = t;

      // Constructed field by field, never spread. The store's contract is that every task
      // it hands out lives in ONE id-space, and a spread cannot promise that — it copies
      // whatever the YAML happened to contain, including a raw `parent` that looks exactly
      // like a globalized one. Now the id-bearing fields are `GlobalId`, which only `nsId`
      // can mint, so a raw string cannot reach them even by accident.
      //
      // That is the compile-time half of the bug this file already carries the runtime half
      // of: `parent` went un-globalized for the tracker's whole life and broke nothing,
      // because nothing read it. The container rule was the first code to trust it, and it
      // would have matched zero children for every epic and gone green.
      const id = nsId(raw['id'], slug);

      // The ONE knowing assertion in this loader, and it is deliberate. A store may hold
      // `status: bogus`, and the loader must be able to REPRESENT that — dropping the row
      // would hide a real task from the human whose typo it is, and `validate` is the
      // authority that reports it, not this. So: keep the value, and SAY SO. The loader
      // was previously silent here, which is how a bogus status could sit in `total` while
      // appearing in no partition and no tally at all.
      const rawStatus = raw['status'];
      if (!isStatus(rawStatus)) {
        warn(`${file}: task ${id}: invalid status ${JSON.stringify(rawStatus)} — it will not appear in ready/blocked (run \`diarie validate\`)`);
      }

      /** @type {LoadedTask} */
      const task = {
        id,
        // TODO: Set to 'invalid' or something when !isStatus(rawStatus)
        status: /** @type {Status} */ (rawStatus),
        deps: safeDeps(raw['deps'], slug, file, String(raw['id']), warn),
        _slug: slug,
        _file: file,
      };
      // EVERY rejected field is REPORTED. A guard that drops a value is not the same thing
      // as a guard that reports it, and conflating the two is how the loader's own type
      // safety turned into three silent bugs:
      //
      //   `labels: epic`      (a scalar, not a list)   -> labels dropped -> `isEpic` false
      //                                                 -> THE EPIC IS OFFERED AS READY WORK.
      //                                                    A container has no deps of its own,
      //                                                    so nothing else stops it: the exact
      //                                                    bug the `epic` label exists to
      //                                                    prevent, re-armed in silence by the
      //                                                    very guard meant to make this safe.
      //   `type: bug`         (a bd fossil; a framing) -> type dropped -> the row appears in
      //                                                    NO partition and NO tally, while
      //                                                    still counting toward `total` —
      //                                                    and its parent, seeing no open
      //                                                    child, is told to close itself.
      //   `priority: urgent`  (not in the enum)        -> silently becomes `medium` everywhere.
      //
      // `status` already warned; the other three did not. The store must be able to REPRESENT
      // a wrong store — `validate` is the authority that rejects it — but it must never be
      // QUIET about one. Writing a task is a hand-edit (no CRUD helper, by design), so these
      // are ordinary slips, not exotic input.
      const reject = rejecter(warn, file, id);

      if (!isNil(raw['parent'])) task.parent = nsId(raw['parent'], slug);
      if (isType(raw['title'], 'string')) task.title = raw['title'];

      if (isPriority(raw['priority'])) task.priority = raw['priority'];
      else if (!isNil(raw['priority'])) reject('priority', raw['priority'], 'it will be treated as `medium`');

      if (isTaskType(raw['type'])) task.type = raw['type'];
      else if (!isNil(raw['type'])) reject('type', raw['type'], 'it will appear in NO partition and no tally');

      if (isStringArray(raw['labels'])) task.labels = raw['labels'];
      else if (!isNil(raw['labels'])) reject('labels', raw['labels'], 'ALL labels are dropped, including `epic` — a container could be offered as ready work');

      if (isStringArray(raw['acceptance_criteria'])) task.acceptance_criteria = raw['acceptance_criteria'];
      else if (!isNil(raw['acceptance_criteria'])) reject('acceptance_criteria', raw['acceptance_criteria'], 'it is dropped');

      if (isType(raw['agent'], 'string')) task.agent = raw['agent'];
      if (isType(raw['updated'], 'string')) task.updated = raw['updated'];
      if (isType(raw['description'], 'string')) task.description = raw['description'];

      all.push(task);
    }
  }

  return all;
}
