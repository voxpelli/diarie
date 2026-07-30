import { lstatSync } from 'node:fs';
import { env } from 'node:process';
import {
  dirname, join, resolve, sep,
} from 'node:path';

import { LEGACY_TRACKER_DIRS, TRACKER_DIRS } from '../schema.js';
import { InputError } from '../utils/errors.js';
import { NoStoreError, TwoStoresError } from './errors.js';
import { isDirectory, realpath } from './utils.js';

/** @import { LegacyTrackerDir, TrackerDir } from '../schema.js' */

/**
 * The environment form of `--root`.
 *
 * It names the PROJECT ROOT that holds the diarium — never the diarium itself. Pointing it
 * at `.diarium/` fails loudly (that directory holds no store of its own), which is the
 * verify-every-path rule below doing its job; the naming is `_ROOT`, not `_DIR`, precisely
 * so the misuse is discouraged before it is caught. (Renamed from `TASKS_ROOT` 2026-07-28,
 * decision `diarie-spa`, following the store's noun rather than the product's name.)
 */
const ROOT_ENV = 'DIARIUM_ROOT';

/** The name it used to have. Read only so that a stale one can be REPORTED, never obeyed. */
const LEGACY_ROOT_ENV = 'TASKS_ROOT';

/**
 * Every variable name that has ever aimed this tool at a project.
 *
 * Exported for `migrate`, which reads NONE of them and must still be able to say so by name
 * — a command that ignores an environment variable on purpose still owes the caller the
 * sentence. Not re-exported from `lib/index.js`: this is an internal seam, not API.
 */
export const ROOT_ENV_NAMES = /** @type {const} */ ([ROOT_ENV, LEGACY_ROOT_ENV]);

/**
 * Which form of the pair exists in `dir`.
 *
 * THE one place the pair is resolved. `TRACKER_DIRS` says what the two names are; this says
 * which of them is actually on disk, and it is the only honest answer to "where is the
 * store" now that the answer is a fact about the filesystem rather than a constant.
 *
 * `name` keeps its LITERAL type rather than widening to `string`. That is the point of having
 * removed the old singular constant: form-confusion should be a compile error, and it cannot
 * be if the thing that reports which form you found forgets which forms exist.
 *
 * @param {string} dir  a candidate project root
 * @returns {{ name: TrackerDir, path: string } | undefined}  undefined if neither form is there
 * @throws {TwoStoresError} when both are
 */
export function trackerDirIn (dir) {
  const found = TRACKER_DIRS
    .map(name => ({ name, path: join(dir, name) }))
    .filter(({ path }) => isDirectory(path));

  if (found.length > 1) {
    throw new TwoStoresError(found.map(f => f.path));
  }

  return found[0];
}
/**
 * A store at a name we no longer use, if one is sitting in `dir`.
 *
 * Shaped like `trackerDirIn` — `{name, path}` — because callers need BOTH spellings: the bare
 * name to say WHAT was found, the absolute path to make the suggested `git mv` copy-pasteable
 * from a subdirectory. It is exported for the same reason `trackerDirIn` is: `init` had grown
 * its own `LEGACY_TRACKER_DIRS.find(d => existsSync(join(root, d)))`, which is this function
 * with the directory check missing — improvised store-detection is how the two halves of a
 * pair drift apart.
 *
 * @param {string} dir
 * @returns {{ name: LegacyTrackerDir, path: string } | undefined}
 */
export function legacyTrackerDirIn (dir) {
  return LEGACY_TRACKER_DIRS
    .map(name => ({ name, path: join(dir, name) }))
    .find(({ path }) => isDirectory(path));
}

/**
 * Refuse to hand back a store that belongs to the PLUGIN rather than to the user.
 *
 * A Claude Code plugin can ship this CLI, and such a plugin may track its OWN work in a
 * committed store of the same shape — so installing it copies the plugin author's backlog
 * into every user's plugin cache. This CLI resolves a store by walking UP from cwd. Run it
 * with a cwd anywhere inside that cache and the walk-up succeeds, on the wrong store, and
 * hands a stranger the plugin's tasks as their own. Exit 0. No warning. A plausible,
 * confident, entirely wrong backlog — which is worse than an error, and is the exact class
 * of failure this store module exists to end.
 *
 * `--root` prevents it, and well-behaved callers pass `--root`. But callers documented in
 * PROSE forget: an audit of one such plugin found 71 documented invocations, not one of
 * which passed it. A defense that depends on every future sentence remembering is not a
 * defense.
 *
 * So the refusal lives HERE, where it cannot rot. `CLAUDE_PLUGIN_ROOT` is set by Claude
 * Code for plugin-spawned processes; a store beneath it is never the user's store. An
 * explicit `--root` is still honoured — if you genuinely mean to read the plugin's own
 * backlog (you are developing the plugin itself), say so.
 *
 * @param {string} dir
 * @returns {void}
 * @throws {NoStoreError}
 */
function assertNotPluginsOwnStore (dir) {
  const pluginRoot = env['CLAUDE_PLUGIN_ROOT'];

  if (!pluginRoot) return;

  // realpath BOTH sides. `resolve()` normalizes but does not follow symlinks, and plugin
  // caches live under paths that are routinely symlinked (on macOS `/tmp` is a link to
  // `/private/tmp`). Comparing an unresolved prefix against a resolved one silently fails
  // to match — a containment check that never contains is a guard that never guards.
  const plugin = realpath(pluginRoot);
  const found = realpath(dir);

  if (found !== plugin && !found.startsWith(plugin + sep)) return;

  const err = new NoStoreError(found, true);

  // TODO: Should we really be modifying the message after the NoStoreError has been created? Surely we should make it more immutable?
  err.message = `refusing to serve the PLUGIN's own store (${found}) as your project's backlog — ` +
    'the walk-up from the current directory landed inside the installed plugin. ' +
    'Pass --root <your-project> (which is what the hooks do), or run from your project root.';

  throw err;
}

/**
 * Read the root override, refusing to silently ignore the retired variable name.
 *
 * A stale `TASKS_ROOT` must not simply be skipped: skipping it drops the caller's explicit
 * root and falls through to the upward walk, which can succeed — on a DIFFERENT store. That
 * is a plausible, confident, wrong backlog, i.e. the one failure this module exists to
 * delete, re-entered through a rename. So it is a hard error naming the new spelling.
 *
 * @returns {string | undefined}
 * @throws {InputError}
 */
function rootFromEnv () {
  const current = env[ROOT_ENV];
  const stale = env[LEGACY_ROOT_ENV];

  // The stale name is checked EVEN WHEN the new one is set, and that ordering is the whole
  // guard. Returning early on `ROOT_ENV` drops a divergent stale value in precisely the case
  // where it does the most damage: a shell (or a hook, or a CI job) that exports both, aimed
  // at two different projects. Whoever set `TASKS_ROOT` believes it is pointing this command
  // at project A; it is silently reading project B's backlog instead, exit 0, plausible
  // output, wrong repo. Agreeing values are not a conflict and pass through — this is a
  // migration aid, not a ban on having the old variable around.
  if (stale && stale !== current) {
    throw new InputError(
      current
        ? `${LEGACY_ROOT_ENV}=${stale} is no longer read, and ${ROOT_ENV}=${current} points somewhere else — ` +
        'two roots, one of them ignored. Unset the stale one, or make them agree.'
        : `${LEGACY_ROOT_ENV} is no longer read — it is now ${ROOT_ENV} (same meaning: the project root holding the store). ` +
        `Rename it, or pass --root ${stale}.`,
      undefined,
      'EUSAGE'
    );
  }

  // `--root` still wins over both without a word, and deliberately so: an explicit flag
  // outranking the environment is ordinary precedence, not a dropped value. Under the old
  // name `TASKS_ROOT` lost to `--root` too, so nothing about the rename changed that answer.
  return current;
}

/**
 * Resolve the project root that holds the store.
 *
 * Order: explicit `--root` > `DIARIUM_ROOT` env > walk up from cwd > throw.
 * There is deliberately no silent fallback to cwd — that is the behaviour this
 * module exists to delete.
 *
 * Returns the PROJECT root, not the store directory: the name is accurate, and callers that
 * need the store itself ask `trackerDirIn` for it. Widening the return to `{root, dir}` was
 * considered and rejected — it would ripple a new type through `requireRoot` and every
 * command's `doTheWork` to save one `existsSync` pair on an already-proven root.
 *
 * Every path is verified, explicit ones included — see the comment in the body.
 * `init` is the one command that does NOT call this (its job is a root with no
 * store yet); it uses `resolveInitRoot`.
 *
 * @param {object} [options]
 * @param {string | undefined} [options.root]  explicit root (the `--root` flag)
 * @param {string} [options.cwd]   where to start the upward search
 * @returns {string}
 * @throws {NoStoreError} when no store is found
 * @throws {TwoStoresError} when both forms of the pair exist at one level
 */
export function resolveRoot ({ cwd = process.cwd(), root } = {}) {
  // EVERY path is verified, including the explicit ones. An explicit `--root`
  // that holds no store is still "told to look and found nothing" — and it is
  // the case that matters most, because automated callers (session hooks and the
  // like) ALWAYS pass `--root`. Trusting it unchecked would hand them back the
  // very empty-backlog lie this module deletes.
  const explicit = root ?? rootFromEnv();

  if (explicit) {
    const dir = resolve(explicit);

    if (!trackerDirIn(dir)) {
      throw new NoStoreError(dir, false, legacyTrackerDirIn(dir)?.path);
    }

    return dir;
  }

  let dir = resolve(cwd);

  while (true) {
    if (trackerDirIn(dir)) {
      assertNotPluginsOwnStore(dir);
      return dir;
    }

    // A legacy store HALTS the walk rather than being stepped over. Walking past a
    // `.diarie/` to some grandparent that happens to hold a `diarium/` would resolve a
    // real store that is not this project's — plausible, confident and wrong, which is
    // strictly worse than an error. The nearest store wins even when it is the old name;
    // it just gets reported instead of read.
    const legacy = legacyTrackerDirIn(dir);

    if (legacy) {
      throw new NoStoreError(dir, true, legacy.path);
    }

    const parent = dirname(dir);

    if (parent === dir) {
      throw new NoStoreError(resolve(cwd), true); // hit the filesystem root
    }

    dir = parent;
  }
}

// TODO: Should become an init command helper rather than live here
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

// TODO: Should perhaps also become an init command helper rather than live here?
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
