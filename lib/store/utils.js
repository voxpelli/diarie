import { realpathSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Derive a file's slug (`tasks-<slug>.yml` → `<slug>`).
 *
 * @param {string} file
 * @returns {string}
 */
export const slugOf = (file) => file.replace(/^tasks-/, '').replace(/\.ya?ml$/, '');

/**
 * Is there a directory at this path?
 *
 * `statSync` (not `lstatSync`): a symlink POINTING at a directory is a directory for our
 * purposes — people do symlink a store into place, and refusing that would be a different
 * wrong answer. `throwIfNoEntry: false` keeps the missing case a value rather than a throw.
 *
 * @param {string} path
 * @returns {boolean}
 */
export function isDirectory (path) {
  return statSync(path, { throwIfNoEntry: false })?.isDirectory() ?? false;
}

/**
 * Resolve a path through symlinks, falling back to a plain resolve if it does not exist.
 *
 * @param {string} p
 * @returns {string}
 */
export function realpath (p) {
  try { return realpathSync(resolve(p)); } catch { return resolve(p); }
}
