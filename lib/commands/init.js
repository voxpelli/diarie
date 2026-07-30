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

import { peowly } from 'peowly';

import { outputFlags, storeFlags } from '../flags/index.js';
import { jsonOut, textOut } from '../format.js';
import { defaultTrackerDir } from '../schema.js';
import { initStore, resolveInitRoot } from '../store/init.js';

/**
 * @import { AnyFlags } from 'peowly'
 * @import { CliCommand, CliMeta } from 'peowly-commands'
 * @import { StoreInitOptions, StoreInitResult } from '../store/init.js'
 */

const flags = /** @satisfies {AnyFlags} */ ({
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

/** @type {CliCommand} */
export const init = {
  description: `Create a ${defaultTrackerDir()}/ task store`,

  async run (argv, meta, { parentName }) {
    const {
      dotted,
      root,
      slug,
      ...formattingOptions
    } = setupCommand(`${parentName} init`, init.description, argv, meta);

    const result = await initStore({ dotted, root, slug });

    formatWorkResult(result, formattingOptions);
  },
};

/** @typedef {{ json: boolean }} FormattingOptions */

/**
 * @param {string} name
 * @param {string} description
 * @param {string[]} args
 * @param {CliMeta} meta
 * @returns {StoreInitOptions & FormattingOptions}
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
 * The ONLY place that writes to the terminal (the STORE was written by doTheWork —
 * two different senses of "write", kept apart on purpose).
 *
 * @param {StoreInitResult} workResult
 * @param {FormattingOptions} context
 * @returns {void}
 */
function formatWorkResult ({ created, root }, { json }) {
  json
    ? jsonOut({ root, created })
    : textOut(
      `Created a task store in ${root}:`,
      ...created.map(f => `  ${f}`),
      '',
      'Commit it. The store IS the repo — that is the whole idea.'
    );
}
