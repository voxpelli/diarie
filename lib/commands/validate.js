/**
 * `diarie validate` — the integrity gate.
 *
 * Reads the WHOLE store, not just `tasks/`: the four passes over `tasks-<slug>.yml`
 * (structural, dep-graph via Kahn, status-transition sanity, test-ratchet), plus every
 * record under `decisions/` and `docs/`, plus an opinion about anything else it finds.
 *
 * That last part is the point rather than a nicety. `tasks/` was all this command had ever
 * read, so a transposed `decisons/` cost sixteen records with every command still exiting 0
 * — the founding defect at directory granularity. `listTaskFiles` structurally cannot catch
 * it: it reads inside `tasks/`, and the mistake is one level up.
 *
 * Exit codes carry meaning:
 *   0  the store is clean (INCLUDING an empty store — that is a real answer)
 *   1  no store here (ENOSTORE) — an InputError, via requireRoot
 *   2  the store exists and is INVALID — a ResultError; the errors are the output
 *
 * Four parts — see `commands/ready.js` for the shape and why `doTheWork` is exported.
 * Note the two distinct channels the WorkResult keeps apart: `warnings` are the
 * linter's, and belong in the ANSWER (stdout, and the `--json` payload); `notices` are
 * asides about the store's shape, and belong on stderr. Collapsing them would put a
 * lint warning somewhere `--json` consumers cannot see it.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { isObject } from '@voxpelli/typed-utils';
import yaml from 'js-yaml';
import { peowly } from 'peowly';

import { outputFlags, requireRoot, storeFlags } from '../flags/index.js';
import { jsonOut, textOut, warn } from '../format.js';
import { RECORD_DIRS, TASKS_DIR } from '../schema.js';
import { parseFrontmatter } from '../store/frontmatter.js';
import { listStoreEntries } from '../store/list-store-entries.js';
import { listTaskFiles } from '../store/list-task-files.js';
import { slugOf } from '../store/utils.js';
import { ResultError } from '../utils/errors.js';
import { lintRecords, lintTasks } from '../validate.js';

/**
 * @import { AnyFlags } from 'peowly'
 * @import { CliCommand, CliMeta } from 'peowly-commands'
 */

/**
 * The store layout, as a clause — derived from `schema.js` rather than spelled out, so a
 * message that tells you what was expected cannot drift from what is actually recognized.
 */
const EXPECTED = [TASKS_DIR, ...Object.values(RECORD_DIRS)].map(dir => `${dir}/`).join(', ');

const flags = /** @satisfies {AnyFlags} */ ({
  ...outputFlags,
  ...storeFlags,
});

/** @type {CliCommand} */
export const validate = {
  description: 'Check the whole store — tasks, records, and stray files — for dangling deps, bad enums, and cycles',

  async run (argv, meta, { parentName }) {
    const input = setupCommand(`${parentName} validate`, validate.description, argv, meta);
    const workResult = await doTheWork(input);

    formatWorkResult(workResult, input);
  },
};

/**
 * @typedef CommandContext
 * @property {boolean} json
 * @property {string} root
 */

/**
 * @param {string} name
 * @param {string} description
 * @param {string[]} args
 * @param {CliMeta} meta
 * @returns {CommandContext}
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
    usage: '[--json]',
  });

  return { json: opts.json, root: requireRoot(opts.root) };
}

/**
 * @typedef WorkResult
 * @property {string[]} errors Fatal: the store is invalid. Includes YAML parse failures.
 * @property {string[]} warnings The linter's — part of the answer, not an aside.
 * @property {string[]} notices Asides about the store's shape (stderr only).
 * @property {number} fileCount
 */

/**
 * Do the work and RETURN it. Prints nothing.
 *
 * @param {Pick<CommandContext, 'root'>} context
 * @returns {Promise<WorkResult>}
 */
export async function doTheWork ({ root }) {
  const { ignored, names, tasksDir } = await listTaskFiles(root);

  /** @type {string[]} */
  const notices = [];

  // A dir of non-matching files is not an empty substrate — surface it. Silently
  // ignoring `tasks_old.yml` would mean validating nothing and calling it clean.
  if (ignored.length && !names.length) {
    notices.push(`tasks/ holds ${ignored.length} file(s) not matching tasks-*.yml (ignored): ${ignored.join(', ')}`);
  }

  /** @type {Array<{ name: string, tasks: unknown }>} */
  const files = [];
  /** @type {string[]} */
  const parseErrors = [];

  for (const name of names) {
    /** @type {unknown} */
    let doc;
    try {
      doc = yaml.load(await readFile(join(tasksDir, name), 'utf8'));
    } catch (err) {
      // Collect; do NOT bail. Bailing to stderr meant `--json` emitted no JSON at
      // all for an unparseable store — so every consumer reading stdout saw empty
      // output and concluded there was nothing to say, on the single commonest
      // hand-edit mistake there is. `--json` ALWAYS emits JSON. That is the contract.
      parseErrors.push(`${name}: invalid YAML — ${/** @type {Error} */ (err).message}`);
      continue;
    }
    // Pass the raw value through — do NOT `?? []` it. That default silently laundered
    // a broken file into a clean empty one: a `task:` typo, or a truncation down to
    // just `meta:`, became `tasks: []`, and `lintTasks`' own Pass-0 guard ("top-level
    // 'tasks' must be a list") could never fire, because it never saw the nil. The
    // whole file's backlog disappeared while validate, ready and stats all exited 0.
    //
    // An empty store is a file that SAYS `tasks: []`. A file that says nothing is not
    // empty — it is broken, and only the linter gets to decide that.
    files.push({ name: slugOf(name), tasks: isObject(doc) ? doc['tasks'] : undefined });
  }

  // --- the rest of the store ------------------------------------------------------------
  // `tasks/` was the only thing validate had ever read, while `schema.js` declares
  // `decisions/` and `docs/` the content-home of two of the four types and `init` creates
  // `decisions/` on every store. Sixteen files in this repo's own store were reported clean
  // because nothing asked — a region the tool cannot see is not an empty backlog.
  const { records, unrecognized } = await listStoreEntries(root);

  /** @type {Array<{ name: string, base: string, type: string, data: Record<string, unknown> }>} */
  const parsedRecords = [];

  for (const record of records) {
    const parsed = parseFrontmatter(await readFile(record.path, 'utf8'));
    if (parsed.ok) {
      parsedRecords.push({ ...record, data: parsed.data });
    } else {
      parseErrors.push(`${record.name}: ${parsed.reason}`);
    }
  }

  const lint = lintTasks(files);
  const recordLint = lintRecords(parsedRecords);

  return {
    errors: [...parseErrors, ...lint.errors, ...recordLint.errors],
    // A stray entry in the store goes in `warnings`, NOT `notices`: `notices` is stderr-only
    // by this file's own design, and a caller reading `--json` would never see it — the
    // whisper this package exists to stop. It is a warning rather than an error because a
    // store owner may legitimately keep their own files here, and the message says how to
    // opt out.
    //
    // ⚠️ The `tasks/`-level `ignored` list two dozen lines above is still on `notices`, so
    // the same defect is reported two ways one directory apart. That is not a considered
    // asymmetry — it is the half of `ignored` that has a test pinning it to `notices`, and
    // moving it is a separate change with its own test update to make.
    warnings: [...lint.warnings, ...unrecognized.map(entry => strayMessage(entry))],
    notices,
    // Every file this run actually read, not just the task files. Left as `files.length` it
    // would have reported "1 file(s)" for a run that validated seventeen — a count that gets
    // MORE wrong the more the command covers.
    fileCount: files.length + parsedRecords.length,
  };
}

/**
 * @param {{ name: string, isDirectory: boolean }} entry
 * @returns {string}
 */
function strayMessage ({ isDirectory, name }) {
  // A stray DIRECTORY is the worse case and gets the sharper sentence: a misspelled
  // `decisons/` hides every record inside it, which is exactly the shape — a whole region
  // of the store invisible while every command exits 0 — that this tool is built against.
  return isDirectory
    ? `${name}/: unrecognized directory in the store — nothing reads inside it, so any records there are MISSING from every count (expected ${EXPECTED}; prefix it with a dot to keep it and be ignored)`
    : `${name}: unrecognized file in the store — nothing reads it (expected ${EXPECTED}; prefix it with a dot to keep it and be ignored)`;
}

/**
 * The ONLY place that writes.
 *
 * @param {WorkResult} workResult
 * @param {Pick<CommandContext, 'json'>} context
 * @returns {void}
 * @throws {ResultError} when the store is invalid
 */
function formatWorkResult ({ errors, fileCount, notices, warnings }, { json }) {
  for (const message of notices) warn(message);

  if (json) {
    jsonOut({ clean: errors.length === 0, errors, warnings });
  } else {
    if (warnings.length) textOut('Warnings:\n' + warnings.map(w => `  ~ ${w}`).join('\n') + '\n');
    // "Store", not "Task" — the count and the noun both stopped being about task files when
    // validate started reading `decisions/` and `docs/`. A command that reads seventeen files
    // and reports on "tasks" describes a narrower job than it did.
    if (errors.length) textOut('Store validation failed:\n\n' + errors.map(e => `  - ${e}`).join('\n') + `\n\n${errors.length} error(s).`);
    // An EMPTY store validating clean is correct and worth saying plainly — it is
    // an ABSENT store that is an error, and requireRoot already caught that.
    else textOut(`Store validation passed (${fileCount} file(s)).`);
  }

  if (errors.length) throw new ResultError('invalid store');
}
