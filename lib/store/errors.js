import { join } from 'node:path';

import { defaultTrackerDir, TRACKER_LABEL } from '../schema.js';
import { InputError } from '../utils/errors.js';

/**
 * Thrown when the store root cannot be found. Carries `code` so machine
 * consumers can distinguish "no store here" from "your backlog is empty" —
 * the distinction the old contract collapsed.
 *
 * EXTENDS `InputError`, and that is load-bearing rather than tidy. `cli.js`'s boundary
 * branches on `InputError` to produce the `{error, code}`-on-stdout contract; anything else
 * lands in its "genuinely unexpected" branch and gets a STACK TRACE on stderr with nothing on
 * stdout — a caller's `jq` fails and reads it as "no data". That is the founding defect, and
 * it shipped: these classes used to extend plain `Error` and rely on `requireRoot` in
 * `lib/flags/store.js` to convert them, which works for every command that resolves a store
 * through the flags layer — and `init` does not. `diarie init --json` in a two-store directory
 * printed a stack trace.
 *
 * Converting at ONE call site was never a contract; it was a habit that happened to hold.
 * Being an `InputError` is the contract, and it holds wherever the error is thrown from.
 */
export class NoStoreError extends InputError {
  /** @override */
  name = 'NoStoreError';

  /**
   * Narrowed from `InputError`'s `string|undefined` to the one literal this class can carry,
   * so a consumer branching on it gets an exhaustive check rather than a string compare.
   *
   * @override
   * @type {'ENOSTORE'}
   */
  code = 'ENOSTORE';

  /**
   * @param {string} from       where we looked
   * @param {boolean} searched  true if we walked up from cwd; false if given an explicit root
   * @param {string} [legacy]   a pre-`diarium` store found at `from`, if any
   */
  constructor (from, searched, legacy) {
    super(legacy
      // A legacy store is not "no store" — it is YOUR store, at the old name. Saying
      // ENOSTORE and stopping would be technically true and practically a lie: the project
      // plainly has a backlog, and the only thing standing between the reader and it is a
      // rename we can spell out. So name it, and name the fix.
      // BOTH sides of the `git mv` are absolute. Mixing an absolute source with a bare
      // target is only correct when cwd happens to be the project root — run this from a
      // subdirectory (which the upward walk exists to support) and the copy-pasted command
      // relocates the store INTO the subdirectory. A suggestion you cannot paste is worse
      // than none: it looks like instructions.
      ? `found ${legacy} — the store is now ${TRACKER_LABEL}. Rename it: ` +
        `\`git mv ${legacy} ${join(from, defaultTrackerDir())}\` ` +
        `(or \`${join(from, defaultTrackerDir(true))}\` to keep it dotted)`
      : (searched
        // Say what was actually done. An explicit --root is not a search, and
        // reporting "searched upward" when we did not is its own small lie.
          ? `no ${TRACKER_LABEL} found in ${from} or any parent — run \`diarie init\`, or pass --root <dir>`
          : `no ${TRACKER_LABEL} in ${from} — run \`diarie init\` there, or point --root somewhere else`));

    /** @type {string} */
    this.from = from;

    /** @type {boolean} */
    this.searched = searched;

    /**
     * Set when the miss was actually a store at a retired name. Carried as a field, not
     * just prose, so a caller can tell "migrate me" from "there is nothing here".
     *
     * @type {string|undefined}
     */
    this.legacy = legacy;
  }
}

/**
 * Thrown when the walk-up landed inside an installed plugin's OWN store.
 *
 * A Claude Code plugin can ship this CLI and track its own work in a committed store of the
 * same shape, so installing it copies the plugin author's backlog into every user's plugin
 * cache. Run from a cwd inside that cache and the upward walk succeeds — on the wrong store.
 * `lib/store/root.js` holds the detection and the full argument for why it lives there.
 *
 * ITS OWN CODE, and that is the entire point of this class existing. The refusal used to be a
 * `NoStoreError` whose message was PATCHED after construction, which produced a fourth variant
 * of ENOSTORE that a machine consumer could not tell from a genuine walk-up miss — `cli.js`
 * serialises `{error, code, body}` and nothing else, so a discriminating FIELD would never have
 * reached a `--json` caller at all. Measured before the fix: both answered `"code": "ENOSTORE"`.
 *
 * 🚨 And the collision is not cosmetic, because the two have OPPOSITE remedies. ENOSTORE's
 * documented answer is `diarie init` — so an automated caller doing exactly what the contract
 * says would CREATE A STORE INSIDE THE PLUGIN CACHE, which the walk-up then finds forever. The
 * guard's failure mode manufactured the state it exists to refuse.
 *
 * It deliberately does NOT extend `NoStoreError`: that class narrows `code` to the literal
 * `'ENOSTORE'` on purpose, so overriding it is TS2416 — the type system enforcing the semantics
 * correctly, and a signal to be obeyed rather than cast away. It extends `InputError` directly,
 * which is the invariant that actually matters (see the header of `lib/utils/errors.js`).
 */
export class PluginStoreError extends InputError {
  /** @override */
  name = 'PluginStoreError';

  /**
   * @override
   * @type {'EPLUGINSTORE'}
   */
  code = 'EPLUGINSTORE';

  /**
   * @param {string} found  the plugin-owned store's project root, already canonicalised
   */
  constructor (found) {
    super(
      `refusing to serve the PLUGIN's own store (${found}) as your project's backlog — ` +
      'the walk-up from the current directory landed inside the installed plugin.',
      // The remedy rides in `body`, so it survives into the `--json` payload rather than being
      // glued onto the message. Naming `--root` first is deliberate: it is what the hooks pass,
      // so a caller reading this has usually forgotten a flag rather than mistaken a directory.
      'Pass --root <your-project> (which is what the hooks do), or run from your project root. ' +
      'If you genuinely mean to read the plugin\'s own backlog — you are developing the plugin ' +
      'itself — an explicit --root is still honoured.'
    );

    /**
     * The plugin-owned root we refused. A field, not just prose, so a caller can report or log
     * WHICH store was declined without parsing the sentence.
     *
     * @type {string}
     */
    this.found = found;
  }
}

/**
 * Thrown when BOTH forms of the pair exist side by side.
 *
 * Precedence rules are how ambiguity becomes permanent — pick one silently and the losing
 * store becomes a file nobody reads and everybody keeps editing. An error is how it gets
 * fixed, so this names both paths and refuses to guess. (Decision `diarie-pos`.)
 *
 * Extends `InputError` for the reason spelled out on `NoStoreError` — this is the class that
 * actually escaped through `init` and printed a stack trace.
 */
export class TwoStoresError extends InputError {
  /** @override */
  name = 'TwoStoresError';

  /**
   * @override
   * @type {'ETWOSTORES'}
   */
  code = 'ETWOSTORES';

  /**
   * @param {string[]} paths  every store found, absolute
   */
  constructor (paths) {
    super(`two stores in the same project — ${paths.join(' and ')}. ` +
      'Exactly one may exist; merge them and remove the other (`git mv` the survivor into place).');

    /** @type {string[]} */
    this.paths = paths;
  }
}
