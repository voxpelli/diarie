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
 * THREE parts here, not four, and the absent one is `doTheWork`. `run` holds no logic,
 * `setupCommand` parses, `formatWorkResult` is the only writer — but the work itself is
 * `initStore` in `lib/store/init.js`, because creating a store is the store layer's job
 * and this command is not its only caller (`migrate` bootstraps one too).
 *
 * That is a different shape, not a missing part, and the distinction is worth stating
 * because the four-part shape's PURPOSE survives it: `doTheWork` is exported so the work
 * can be asserted in-process, and `initStore` is exported from where it lives for exactly
 * the same reason. `test/commands.spec.js` drives it directly.
 *
 * The refusal lives in `initStore` for the reason it would have lived in a `doTheWork`:
 * it is a fact about the disk, not about the arguments.
 *
 * (`migrate` is the one command with no split at all — its flags are repeatable
 * `key=value` pairs parsed by the migrator itself.)
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
    // No positionals — see `commands/ready.js` for why, and for the peowly mechanics.
    allowPositionals: false,
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
 * The ONLY place that writes to the terminal (the STORE was written by `initStore` —
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
