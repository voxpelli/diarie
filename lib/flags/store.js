/**
 * Store-location flags — shared by every command that reads a store.
 *
 * `requireRoot` is deliberately NOT named `validateStoreFlags`: it touches the
 * filesystem (it searches upward for the store), so it is a resolution seam, not a
 * pure validator. The pure ones are `validateFilterFlags` and `validateStaleFlags`;
 * do not hold this up as an example of that pattern.
 */

import { TRACKER_LABEL } from '../schema.js';
import { resolveRoot } from '../store/root.js';

/**
 * @import { AnyFlags } from 'peowly'
 */

export const storeFlags = /** @satisfies {AnyFlags} */ ({
  root: {
    description: `Project root holding ${TRACKER_LABEL} (default: search upward from cwd)`,
    listGroup: 'Store options',
    type: 'string',
  },
});

/**
 * Resolve the store root, converting a NoStoreError into an InputError.
 *
 * A missing store is a USER error, not a crash and — emphatically — not an empty
 * backlog. The tracker used to print `{"ready":[]}` to stdout and its only warning
 * to a stderr that ten call sites discard, so "I can't find your store" and "you
 * have no work" were indistinguishable to every consumer. That is the bug this
 * function exists to make impossible.
 *
 * The ENOSTORE code rides on the error so `--json` callers can branch on it. ETWOSTORES —
 * both forms of the store pair present at once — carries the same guarantee.
 *
 * THIS NO LONGER CONVERTS ANYTHING, and the reason is worth keeping. It used to catch the
 * store errors and re-throw them as `InputError`, which meant the `{error, code}`-on-stdout
 * contract held only for commands that resolved their store through THIS function. `init`
 * does not — it asks `trackerDirIn` directly — so `diarie init --json` in a two-store
 * directory bypassed the conversion entirely and printed a stack trace to stderr with an
 * empty stdout. A contract enforced at one call site is not a contract.
 *
 * The store errors now extend `InputError` at their definition (see `lib/store/errors.js`), so they
 * satisfy it wherever they are thrown. This function survives as the named seam for "a
 * missing store is a USER error" — deleting it would lose that statement, and `resolveRoot`
 * alone does not say it.
 *
 * @param {string|undefined} root
 * @returns {string}
 */
export function requireRoot (root) {
  return resolveRoot({ root });
}
