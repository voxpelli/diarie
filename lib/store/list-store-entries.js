import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { RECORD_DIRS, TASKS_DIR } from '../schema.js';
import { NoStoreError } from './errors.js';
import { legacyTrackerDirIn, trackerDirIn } from './root.js';

/** Records are frontmatter'd markdown. `bd-map.js` writes `<id>.md`; this reads the same. */
const RECORD_FILE_RE = /\.md$/;

/**
 * @typedef StoreRecord
 * @property {string} path      absolute, for reading
 * @property {string} name      store-relative, for reporting (`decisions/diarie-pos.md`)
 * @property {string} base      the filename without `.md` — the id the writer promised
 * @property {import('../schema.js').RecordType} type  the type this DIRECTORY is the home of
 */

/**
 * @typedef StoreEntry
 * @property {string} name          store-relative
 * @property {boolean} isDirectory  a stray FILE and a stray DIRECTORY hide different amounts
 */

/**
 * List everything the store holds that is not a task file.
 *
 * This exists because nothing enumerated the store itself. `listTaskFiles` reads
 * `<store>/tasks/`, so its `ignored` list — the one "you have a stray file here" channel the
 * tool had — cannot see one level up. A transposed `decisons/` was therefore invisible in
 * full: sixteen records gone, every command exiting 0, which is this package's founding
 * defect at directory granularity.
 *
 * Deliberately does NOT descend into `tasks/`. That directory has a reader already, and a
 * second one would fork the `tasks-*.yml` naming rule — the recurring cost this codebase
 * pays whenever one fact gets two implementations.
 *
 * Dot-prefixed entries are skipped at every level, matching `listTaskFiles`. That is the
 * escape hatch: a store owner who wants a scratch file the tool ignores prefixes it, and any
 * message about a stray entry must say so, or the report is a complaint with no remedy.
 *
 * Returns no store path. Every record carries its own absolute `path` for reading and a
 * store-relative `name` for reporting, so a caller never needs to rejoin anything — and a
 * returned-but-unused field is a small invitation to derive a second path a different way.
 *
 * @param {string} root
 * @returns {Promise<{ records: StoreRecord[], unrecognized: StoreEntry[] }>}
 * @throws {NoStoreError} when `root` holds no store (it was not resolved by `resolveRoot`)
 * @throws {TwoStoresError} when it holds both
 */
export async function listStoreEntries (root) {
  // Resolve first, then look — same reason as `listTaskFiles`: this is a public export, so
  // `root` may arrive relative, and `NoStoreError`'s `git mv` remedy is only pasteable with
  // absolute paths on both sides.
  const from = resolve(root);
  const store = trackerDirIn(from);

  if (!store) {
    throw new NoStoreError(from, false, legacyTrackerDirIn(from)?.path);
  }

  /** @type {Map<string, import('../schema.js').RecordType>} */
  const recordDirs = new Map(
    Object.entries(RECORD_DIRS).map(([type, dir]) => [dir, /** @type {import('../schema.js').RecordType} */ (type)])
  );

  /** @type {StoreRecord[]} */
  const records = [];
  /** @type {StoreEntry[]} */
  const unrecognized = [];

  // `readdir` on a store that exists cannot be skipped the way `tasks/` can: `trackerDirIn`
  // already proved this is a directory.
  for (const entry of await readdir(store.path, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    if (entry.name === TASKS_DIR) continue;
    if (!recordDirs.has(entry.name)) {
      unrecognized.push({ name: entry.name, isDirectory: entry.isDirectory() });
      continue;
    }
    // A recognized NAME that is not a directory is left to fail loudly on `readdir`
    // (ENOTDIR), the same call the sibling module makes and for the same recorded reason: a
    // store whose `decisions` is a file is plainly broken, and returning an empty list for it
    // would report it clean.
    records.push(...await readRecordDir(store.path, entry.name, unrecognized, recordDirs));
  }

  return { records, unrecognized };
}

/**
 * @param {string} storePath
 * @param {string} dir
 * @param {StoreEntry[]} unrecognized  appended to
 * @param {Map<string, import('../schema.js').RecordType>} recordDirs
 * @returns {Promise<StoreRecord[]>}
 */
async function readRecordDir (storePath, dir, unrecognized, recordDirs) {
  const full = join(storePath, dir);
  // An absent record directory is ORDINARY, not broken — `init` never creates `docs/` at all,
  // so erroring on its absence would fail every store the tool itself writes.
  if (!existsSync(full)) return [];

  const type = recordDirs.get(dir);
  if (type === undefined) return [];

  /** @type {StoreRecord[]} */
  const records = [];

  for (const entry of await readdir(full, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    if (entry.isDirectory() || !RECORD_FILE_RE.test(entry.name)) {
      unrecognized.push({ name: `${dir}/${entry.name}`, isDirectory: entry.isDirectory() });
      continue;
    }
    records.push({
      path: join(full, entry.name),
      name: `${dir}/${entry.name}`,
      base: entry.name.replace(RECORD_FILE_RE, ''),
      type,
    });
  }

  return records;
}
