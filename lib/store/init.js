import { lstatSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { resolve } from 'node:path/posix';
import { defaultTrackerDir, TRACKER_LABEL } from '../schema.js';
import { InputError } from '../utils/errors.js';
import { legacyTrackerDirIn, rootFromEnv, trackerDirIn } from './root.js';
import { isDirectory } from './utils.js';

/** A new store. Not a template — just the shape. */
const STARTER = `# The task store. Plain YAML, committed, reviewed in PRs like any other file.
#
# A task is ready iff type is task, status is pending, and every dep is completed.
# Write tasks by editing this file — there is no CRUD command, on purpose.
#
#   - id: T-1
#     title: Do the thing
#     status: pending        # pending | in_progress | completed | failed | cancelled | deferred
#     type: task             # task | doc | decision | milestone
#     priority: medium       # critical | high | medium | low | backlog
#     labels: [bug]          # framings: bug/feature/chore/story/spike
#     deps: [T-0]            # must be completed before this is ready
#     acceptance_criteria:
#       - how you will know it is done

tasks: []
`;

/**
 * @typedef StoreInitOptions
 * @property {boolean} dotted Write the dotted form of the pair rather than the visible one.
 * @property {string} root Where the store WILL be — it does not exist yet.
 * @property {string} slug
 */

/**
 * @typedef StoreInitResult
 * @property {string[]} created Paths, relative to the root.
 * @property {string} root
 */

/**
 * Create the store and RETURN what was created. Prints nothing.
 *
 * Four refusals, in order — see the comments; each answers a different question, and
 * collapsing them would let one silently do another's job.
 *
 * @param {StoreInitOptions} options
 * @returns {Promise<StoreInitResult>}
 */
export async function initStore (options) {
  const {
    dotted,
    root,
    slug,
  } = options;

  const name = defaultTrackerDir(dotted);

  // (1) BOTH forms already present. `trackerDirIn` throws ETWOSTORES for us — creating a
  // third thing on top of an ambiguity nobody has resolved would only bury it deeper.
  const existing = trackerDirIn(root);

  // (2) EITHER form already present. Refuse, always: never merge, never overwrite, never
  // "helpfully" back up.
  //
  // The message names the FOUND form, not the requested one. `init --dotted` in a directory
  // holding a visible `diarium/` must say so — reporting the name you asked for reads as
  // "your flag was ignored", and sends you looking for a bug in the flag instead of at the
  // store already sitting there.
  //
  // `EEXIST` is the exact inverse of `ENOSTORE`, and it is a state, not a typo — so it gets its
  // own code rather than EUSAGE. A caller that wanted `init` to be idempotent can now branch on
  // it instead of regexing this sentence. (It shipped with NO code at all, which meant a --json
  // consumer got a bare `{error: "..."}` and had no way to tell this refusal — the whole reason
  // the guard exists — apart from any other input error.)
  if (existing) {
    const posture = existing.name === name ? '' : ' (the other posture — the pair is one store, not two)';
    throw new InputError(
      `${existing.name}/ already exists in ${root}${posture} — refusing to touch an existing store`,
      undefined,
      'EEXIST'
    );
  }

  // (3) A store at a RETIRED name. This is the one refusal that is genuinely new, and it
  // exists because of how the read side behaves: a reader that finds `.diarie/` reports
  // ENOSTORE (there is indeed no diarium), and a helpful caller — a session hook, a script,
  // a person — answers ENOSTORE by running `init`. Without this check that call succeeds and
  // the project now has TWO backlogs, the old one still holding all the work and nothing
  // pointing at it. Refuse and name the rename instead.
  // Through the shared resolver, not a local `LEGACY_TRACKER_DIRS.find(...)`: the local copy
  // asked `existsSync` where the resolver asks "is it a DIRECTORY", so the two disagreed about
  // what a store is. Both spellings are used below — the bare name to say what was found, the
  // absolute path so the `git mv` survives being pasted from anywhere. Both sides absolute:
  // with `--root elsewhere/`, a relative pair would rename a directory in the CURRENT one.
  const legacy = legacyTrackerDirIn(root);
  if (legacy) {
    throw new InputError(
      `${legacy.name}/ already exists in ${root} — that IS your store, at the name diarie used before ${TRACKER_LABEL}. ` +
      `Rename it rather than starting a second one: \`git mv ${legacy.path} ${join(root, name)}\``,
      undefined,
      'ELEGACY'
    );
  }

  // (4) The path is occupied by something that is NOT a store — a plain file, a broken
  // symlink. `trackerDirIn` refuses to call that a store (rightly: a file answering "yes"
  // is how a reader serves a confident empty backlog), which left the write side seeing
  // nothing at all and walking into `mkdir`'s ENOTDIR — a non-`InputError`, so `cli.js`
  // answers it with a stack trace on stderr and an EMPTY stdout. Under `--json` that is
  // indistinguishable from "no data", which is the defect this package exists to delete.
  assertStorePathFree(root, name);

  const store = join(root, name);

  await mkdir(join(store, 'tasks'), { recursive: true });
  await mkdir(join(store, 'decisions'), { recursive: true });
  await writeFile(join(store, 'tasks', `tasks-${slug}.yml`), STARTER, 'utf8');

  return {
    root,
    created: [`${name}/tasks/tasks-${slug}.yml`, `${name}/decisions/`],
  };
}

/**
 * Refuse to create a store on a path that is occupied by something which is not a directory.
 *
 * The other half of `isDirectory`. Tightening the store-detection to "is it a DIRECTORY"
 * correctly stopped a plain file named like a store from being READ as one — but the write
 * side then saw the same file as nothing at all and walked straight into `mkdir`, which
 * answers ENOTDIR. That error is not one of ours, so `cli.js` files it under "genuinely
 * unexpected" and replies with a stack trace on stderr and NOTHING on stdout.
 *
 * `lstatSync`, not `existsSync`: a broken symlink is an occupied path that `existsSync`
 * reports as free, and `mkdir` fails on it just the same. A symlink POINTING at a directory
 * is fine — that is the case `isDirectory` deliberately allows.
 *
 * @param {string} dir   the project root the store will be created in
 * @param {string} name  the store name about to be created
 * @returns {void}
 * @throws {InputError} EEXIST — something is already sitting there, and it is not a store
 * @see {@link isDirectory}
 */
export function assertStorePathFree (dir, name) {
  const path = join(dir, name);
  if (lstatSync(path, { throwIfNoEntry: false }) && !isDirectory(path)) {
    throw new InputError(
      `${path} already exists and is not a directory — refusing to create a store on top of it`,
      undefined,
      'EEXIST'
    );
  }
}

/**
 * Resolve the root for `init` — the one command whose job is a root with NO store
 * yet. No search, no ENOSTORE: you are naming where the store will be created.
 *
 * @param {{ cwd?: string, root?: string|undefined }} [options]
 * @returns {string}
 */
export function resolveInitRoot ({ cwd = process.cwd(), root } = {}) {
  return resolve(root ?? rootFromEnv() ?? cwd);
}
