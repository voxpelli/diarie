/**
 * index.js — diarie's public library surface.
 *
 * The node-cli-template this package follows is bin-only ("consumers never import
 * the CLI as a library"), but diarie is a library-with-a-bin: a consuming project's
 * own tooling imports these pure functions directly rather than shelling out to the
 * binary and parsing its stdout — validators, migration probes, and test suites all
 * want the computation, not the rendering. Hence `exports` alongside `bin`.
 *
 * `./schema` is exported as its own subpath because it is THE AUTHORITY — the
 * one definition of the enums, the ready rule's vocabulary, and the store-name pair
 * (`TRACKER_DIRS`). An ast-grep rule enforces that nothing hardcodes the tracker
 * directory instead of importing it from here — and that rule deliberately reaches
 * CONSUMERS too, not just this package: a hardcoded store segment in a consumer's guard
 * code would not error after a rename, it would silently stop guarding.
 *
 * Consumers that used to import the old singular `TRACKER_DIR` want `trackerDirIn(root)`
 * from here instead: the store's directory is now a pair, so which form is in play is a
 * fact about the filesystem rather than a constant, and only a resolver can answer it.
 */

export * from './schema.js';
export {
  computeReady, computeStats, formatStats, line,
} from './ready.js';
export { lintTasks } from './validate.js';
export {
  listTaskFiles, loadTasks, NoStoreError, resolveInitRoot, resolveRoot, slugOf, trackerDirIn,
  TwoStoresError,
} from './store.js';
// `nsId` is NOT re-exported here — it comes from `export * from './schema.js'` above,
// which is now its only home. It used to live in store.js as a second copy of the rule.
