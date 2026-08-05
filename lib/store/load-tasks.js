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

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import yaml from 'js-yaml';
import {
  isObject, isStringArray, isType, typesafeIsArray,
} from '@voxpelli/typed-utils';

import { renderRejected } from '../format.js';
import { listTaskFiles } from './list-task-files.js';
import { slugOf } from './utils.js';
import {
  isNil, isPriority, isStatus, isTaskType, nsId,
} from '../schema.js';

/** @import { GlobalId, Priority, Status, TaskType } from '../schema.js' */

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
 * @property {Status} [status]  OPTIONAL, on the same rule as `title`/`priority`/`type` either
 *   side of it: the loader must be able to REPRESENT a row that is wrong. Undefined means the
 *   row has no usable status, and `computeReady` answers that with `needsAttention` rather
 *   than by dropping it.
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
  warn(`${file}: task ${id}: invalid ${field} ${renderRejected(value)} — ${consequence} (run \`diarie validate\`)`);
};

/**
 * @param {string} tasksDir
 * @param {string[]} names
 * @param {(msg: string) => void} warn
 * @returns {AsyncGenerator<{ file: string, raw: unknown, slug: string }, void, unknown>}
 */
async function * loadRawTasks (tasksDir, names, warn) {
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
      // TODO: Should use pony-cause messageWithCauses()
      warn(`${file}: invalid YAML — the whole file is skipped, so any rows in it are MISSING from every count (run \`diarie validate\`): ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`);
      continue;
    }

    const list = isObject(doc) ? doc['tasks'] : undefined;

    if (isNil(list)) continue;
    if (!typesafeIsArray(list)) {
      warn(`${file}: "tasks" is not a list — skipping file (run \`diarie validate\`)`);
      continue;
    }

    for (const raw of list) {
      yield { file, raw, slug };
    }
  }
}

/**
 * @param {GlobalId} id
 * @param {string} slug
 * @param {Record<string, unknown>} raw
 * @param {(field: string, value: unknown, consequence: string) => void} reject
 * @returns {Task}
 */
function createTaskFromRawData (id, slug, raw, reject) {
  const rawStatus = raw['status'];

  if (!isStatus(rawStatus)) {
    reject('status', rawStatus, 'it will not appear in ready or blocked, and joins no tally — the row is surfaced as needing attention instead');
  }

  const rawDeps = raw['deps'];

  if (!isNil(rawDeps) && !typesafeIsArray(rawDeps)) {
    reject('deps', rawDeps, 'treating as empty');
  }

  /** @type {Task} */
  const task = {
    id,
    deps: typesafeIsArray(rawDeps) ? rawDeps.map(d => nsId(d, slug)) : [],
  };

  // OMITTED WHEN IT IS NOT A STATUS, exactly like every other field here. The row survives —
  // a store may hold `status: bogus` and this loader must REPRESENT it rather than refuse the
  // file — but `undefined` is the honest carrier for "there was no usable answer", and
  // `computeReady` surfaces such a row in `needsAttention` rather than dropping it.
  //
  // A SENTINEL IS THE WRONG FIX HERE, and it is the tempting one. Inside `Status` it poisons
  // the vocabulary every consumer switches on: `byStatus` grows a column no store can contain
  // and `--filter invalid` becomes answerable. Outside it, every downstream `isStatus` drops
  // the row and it vanishes from `total` — the disappearance this file exists to have ended.
  if (isStatus(rawStatus)) task.status = rawStatus;

  if (!isNil(raw['parent'])) task.parent = nsId(raw['parent'], slug);

  // THE FOUR BELOW WERE THE `diarie-rdr` BUG: each was a bare `if` with no `else`, so a
  // non-string value was dropped in total silence — by the reader, in the package whose
  // founding law is that a guard which DROPS a value must also REPORT it, naming the
  // consequence. Their six siblings above and below did report. These four did not, and
  // `ready --strict` was built on top of the hole: `unsound` is computed from
  // `warnings.length`, so the one flag that promises "this store is trustworthy" was
  // answering 0 precisely because the drop was quiet.
  //
  // An ABSENT field is not a REJECTED one — hence `!isNil`, matching every sibling guard.
  if (isType(raw['title'], 'string')) task.title = raw['title'];
  else if (!isNil(raw['title'])) reject('title', raw['title'], 'the row is listed with an EMPTY title — an id and a priority, and nothing a human can recognise it by');

  if (isPriority(raw['priority'])) task.priority = raw['priority'];
  else if (!isNil(raw['priority'])) reject('priority', raw['priority'], 'it will be treated as `medium`');

  if (isTaskType(raw['type'])) task.type = raw['type'];
  else if (!isNil(raw['type'])) reject('type', raw['type'], 'it will appear in NO partition and no tally');

  if (isStringArray(raw['labels'])) task.labels = raw['labels'];
  else if (!isNil(raw['labels'])) reject('labels', raw['labels'], 'ALL labels are dropped, including `epic` — a container could be offered as ready work');

  if (isStringArray(raw['acceptance_criteria'])) task.acceptance_criteria = raw['acceptance_criteria'];
  else if (!isNil(raw['acceptance_criteria'])) reject('acceptance_criteria', raw['acceptance_criteria'], 'it is dropped');

  if (isType(raw['agent'], 'string')) task.agent = raw['agent'];
  else if (!isNil(raw['agent'])) reject('agent', raw['agent'], 'the claim is dropped — `ready --json` serves the row as unclaimed while the YAML says it is held');

  if (isType(raw['updated'], 'string')) task.updated = raw['updated'];
  else if (!isNil(raw['updated'])) reject('updated', raw['updated'], 'staleness never fires for this row — `stats` reports it as fresh, and can answer `stale 0` for a store that does have abandoned claims');

  if (isType(raw['description'], 'string')) task.description = raw['description'];
  else if (!isNil(raw['description'])) reject('description', raw['description'], 'the body is dropped — `ready --json` serves the row with no `description` at all');

  return task;
}

/**
 * Load and globalize every task under a resolved root. Bare dep ids are
 * namespaced to their file's slug; `slug/id` deps pass through.
 *
 * RETURNS AN ARRAY, AND MUST KEEP DOING SO. This is a published export, and it was
 * briefly an `async function *` — which broke two things at once:
 *
 * 1. Every existing consumer. `await loadTasks(root)` yields the generator OBJECT, not
 *    the tasks, and `await` raises nothing because an AsyncGenerator is not a thenable.
 *    A typed consumer at least gets TS2339 on `.length`; an UNTYPED one — and diarie is
 *    a JS library that must assume consumers who never run `tsc` — gets
 *    `if (tasks.length)` reading `undefined`, i.e. **an empty backlog reported for a full
 *    store, at exit 0.** The founding defect, in the public API, via the most ordinary
 *    consumer line there is.
 * 2. `ENOSTORE`. Calling a generator does not run its body, so `listTaskFiles`'s throw
 *    was deferred to the first `next()`. Verified: `loadTasks('/not/a/store')` returned
 *    without throwing, and only iteration surfaced the error. A consumer that obtains the
 *    iterator and returns early would never learn there is no store — the exact coupling
 *    list-task-files.js:14-22 argues must not exist.
 *
 * Streaming buys nothing here regardless: computeReady builds `byId` and `childrenByParent`
 * as COMPLETE indices before any verdict is computable, because a task's readiness depends
 * on deps that may live in a later file. There is no consumer for which the first element
 * is useful before the last.
 *
 * @param {string} root
 * @param {(msg: string) => void} [warn]
 * @returns {Promise<LoadedTask[]>}
 */
export async function loadTasks (root, warn = () => {}) {
  const { names, tasksDir } = await listTaskFiles(root);

  /** @type {LoadedTask[]} */
  const tasks = [];

  for await (const { file, raw, slug } of loadRawTasks(tasksDir, names, warn)) {
    if (!isObject(raw) || isNil(raw['id'])) {
      warn(`${file}: a task entry has no id — skipping it (run \`diarie validate\`)`);
      continue;
    }

    const id = nsId(raw['id'], slug);

    tasks.push({
      ...createTaskFromRawData(id, slug, raw, rejecter(warn, file, id)),
      _slug: slug,
      _file: file,
    });
  }

  return tasks;
}

/**
 * @param {string} root
 * @returns {Promise<{ tasks: LoadedTask[], warnings: string[] }>}
 */
export async function loadTasksWithWarnings (root) {
  /** @type {string[]} */
  const warnings = [];

  const tasks = await loadTasks(root, m => warnings.push(m));

  return { tasks, warnings };
}
