import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { NoStoreError } from './errors.js';
import { legacyTrackerDirIn, trackerDirIn } from './root.js';

/** Matches the task files the store globs. Decisions and docs are deliberately outside it. */
const TASKS_FILE_RE = /^tasks-.+\.ya?ml$/;

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
