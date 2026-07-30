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
export * from './store.js';

export {
  computeReady, computeStats, formatStats, line,
} from './ready.js';
export { lintTasks } from './validate.js';

// The BASE of the error taxonomy, and the only catch that covers every user-error this
// package throws. `NoStoreError`/`TwoStoresError` extend it, so a consumer can narrow to the
// specific one or to all of them — including the failures that have no subclass at all (a
// stale `TASKS_ROOT`, a bad flag). Without it, exporting only the two subclasses left the rest
// reachable solely by regexing `err.message`, which is the anti-pattern the `code` field and
// its `ErrorCode` type exist to delete. `ResultError` stays unexported: it means "the answer
// is no", is thrown only by commands that have already printed their answer, and a library
// consumer calling these functions never produces one.
export { InputError } from './utils/errors.js';
