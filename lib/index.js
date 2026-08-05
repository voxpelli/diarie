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

// `./schema` STAYS a star-export, and that is not an inconsistency with the named lists below.
// `exports["./schema"]` already publishes that module whole, so narrowing it here would only
// change which of two doors the same names come through. What it DOES cost is a gate: editing
// `schema.js` widens the public API with nothing going red — `TASKS_DIR` and `RECORD_DIRS` went
// public exactly that way. `test/api.spec.js` therefore pins BOTH entry points by equality,
// because an allowlist over this file alone would not have seen it.
export * from './schema.js';

// THE STORE LAYER, NAMED ONE MODULE AT A TIME rather than routed through a re-export barrel.
// A barrel between here and the real modules means the published surface can widen from a file
// that does not look like this one — an indirection nobody reviewing the API would think to
// open. Each name below points at where it is defined.
export { NoStoreError, PluginStoreError, TwoStoresError } from './store/errors.js';
export { resolveInitRoot } from './store/init.js';
export { listTaskFiles } from './store/list-task-files.js';
export { loadedTaskToTask, loadTasks, loadTasksWithWarnings } from './store/load-tasks.js';
export { resolveRoot, trackerDirIn } from './store/root.js';
export { slugOf } from './store/utils.js';

export {
  attentionLine, blockedLine, computeReady, computeStats, formatStats, line,
} from './ready.js';
export { lintTasks } from './validate.js';

// The BASE of the error taxonomy, and the only catch that covers every user-error this
// package throws. `NoStoreError`/`PluginStoreError`/`TwoStoresError` extend it, so a consumer can narrow to the
// specific one or to all of them — including the failures that have no subclass at all (a
// stale `TASKS_ROOT`, a bad flag). Without it, exporting only the two subclasses left the rest
// reachable solely by regexing `err.message`, which is the anti-pattern the `code` field and
// its `ErrorCode` type exist to delete. `ResultError` stays unexported: it means "the answer
// is no", is thrown only by commands that have already printed their answer, and a library
// consumer calling these functions never produces one.
export { InputError } from './utils/errors.js';

// WHAT IS DELIBERATELY *NOT* HERE, recorded because an absence leaves no other trace and the
// equality test in `test/api.spec.js` will otherwise read as an arbitrary list:
//
// * `initStore` — the one function in this package that CREATES a store. VISION.md refuses a
//   CRUD layer on the grounds that it would make diarie the owner of your data; the bin may
//   write, but publishing the writer is how a library acquires the layer the vision declines.
//   It stays importable by the suite, which is a different thing from being published.
// * `ResultError` — see above.
// * `ROOT_ENV_NAMES`, `legacyTrackerDirIn`, `rootFromEnv`, `lintFields`, `lintRecords`,
//   `listStoreEntries`, `parseFrontmatter` — internal seams. They exist so two callers cannot
//   drift apart, not so a consumer can depend on them.
// * `isUsableId`/`isUsableRef` (`lib/ids.js`) — the same, and deliberately so even though
//   `ID_RE` beside them IS public. A regex is a fact a consumer may want; a predicate is a
//   RULE, and publishing it would freeze the two-form ref shape as a contract while
//   `diarie-xid` is still open on what an id authority should be. `renderRejected` is the
//   precedent: the reporting half of this guard is internal too.
//
// Adding a name above is a public-contract change and costs a line in the test. That friction
// IS the feature: two exports went public by accident through a star-export, and nothing went
// red.
