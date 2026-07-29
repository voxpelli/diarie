/**
 * `diarie init` — create a store.
 *
 * The one command that must accept a root with NO store, so it uses
 * `resolveInitRoot` rather than `requireRoot` — you are naming where the store WILL
 * be, not asking us to find one.
 *
 * It refuses to touch an existing store. A tracker that can silently clobber your
 * backlog is not a tracker; and the whole premise here is that the data IS the repo,
 * so an overwrite is a `git checkout` away from being permanent.
 *
 * What it writes is deliberately tiny — a store is a directory and a list. There is
 * no `.diarierc`, no config, no state file. If this command ever grows a template
 * engine, something has gone wrong with the substrate.
 *
 * `--dotted` is not a config knob and does not contradict the above (decision `diarie-loc`
 * refuses the knob; `diarie-pos` grants the posture). It picks which of exactly TWO
 * directory names gets created, and after that the choice is expressed by what is on disk —
 * nothing is stored, nothing is read back, and `git mv` flips it whenever you like.
 *
 * Four parts, even though the work here is a SIDE EFFECT rather than a computation:
 * `doTheWork` writes the store and returns what it created, and `formatWorkResult`
 * decides how to say so. The refusal lives in `doTheWork` because it is a fact about
 * the disk, not about the arguments. (`migrate` is the one command with no such split
 * — its flags are repeatable `key=value` pairs parsed by the migrator itself.)
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { peowly } from 'peowly';

import { outputFlags, storeFlags } from '../flags/index.js';
import { jsonOut, textOut } from '../format.js';
import { defaultTrackerDir, TRACKER_LABEL } from '../schema.js';
import {
  assertStorePathFree, legacyTrackerDirIn, resolveInitRoot, trackerDirIn,
} from '../store.js';
import { InputError } from '../utils/errors.js';

const flags = /** @satisfies {import('peowly').AnyFlags} */ ({
  ...outputFlags,
  ...storeFlags,
  slug: {
    description: 'Name of the first task file (tasks-<slug>.yml)',
    type: 'string',
    'default': 'backlog',
  },
  dotted: {
    description: `Create ${defaultTrackerDir(true)}/ instead of ${defaultTrackerDir()}/ (the reading-room posture)`,
    type: 'boolean',
    'default': false,
  },
});

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

/** @type {import('peowly-commands').CliCommand} */
export const init = {
  description: `Create a ${defaultTrackerDir()}/ task store`,

  async run (argv, meta, { parentName }) {
    const input = setupCommand(`${parentName} init`, init.description, argv, meta);
    const workResult = await doTheWork(input);

    formatWorkResult(workResult, input);
  },
};

/**
 * @typedef CommandContext
 * @property {boolean} json
 * @property {string} root Where the store WILL be — it does not exist yet.
 * @property {string} slug
 * @property {boolean} dotted Write the dotted form of the pair rather than the visible one.
 */

/**
 * @param {string} name
 * @param {string} description
 * @param {string[]} args
 * @param {import('peowly-commands').CliMeta} meta
 * @returns {CommandContext}
 */
function setupCommand (name, description, args, meta) {
  const { flags: opts } = peowly({
    ...meta,
    args,
    description,
    name,
    options: flags,
    usage: '[--slug <name>] [--dotted] [--root <dir>]',
  });

  return {
    dotted: opts.dotted,
    json: opts.json,
    root: resolveInitRoot({ root: opts.root }),
    slug: opts.slug,
  };
}

/**
 * @typedef WorkResult
 * @property {string} root
 * @property {string[]} created Paths, relative to the root.
 */

/**
 * Create the store and RETURN what was created. Prints nothing.
 *
 * Four refusals, in order — see the comments; each answers a different question, and
 * collapsing them would let one silently do another's job.
 *
 * @param {Pick<CommandContext, 'root'|'slug'|'dotted'>} context
 * @returns {Promise<WorkResult>}
 * @throws {InputError} when a store — of either form, or a retired one — is already there
 * @throws {import('../store.js').TwoStoresError} when both forms are already there
 */
export async function doTheWork ({ dotted, root, slug }) {
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
 * The ONLY place that writes to the terminal (the STORE was written by doTheWork —
 * two different senses of "write", kept apart on purpose).
 *
 * @param {WorkResult} workResult
 * @param {Pick<CommandContext, 'json'>} context
 * @returns {void}
 */
function formatWorkResult ({ created, root }, { json }) {
  if (json) return jsonOut({ root, created });

  textOut([
    `Created a task store in ${root}:`,
    ...created.map(f => `  ${f}`),
    '',
    'Commit it. The store IS the repo — that is the whole idea.',
  ].join('\n'));
}
