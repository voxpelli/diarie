/**
 * api.spec.js — the published surface, pinned by EQUALITY.
 *
 * This package is a library-with-a-bin, so its exports are a contract in the same way its exit
 * codes are. Nothing else in the repo can hold that contract:
 *
 * * knip detects DEAD exports, never NEW ones, and it derives its entry points from `exports` —
 *   so everything reachable from `lib/index.js` is legitimately public to it, by construction.
 * * `tsc` type-checks what is exported; it has no opinion on whether it should be.
 * * a test that asserts a name IS exported catches removal and is free for addition, which is
 *   the wrong half — removing a name breaks a consumer loudly, adding one binds this package to
 *   support it forever, quietly.
 *
 * Hence `deepEqual` over a sorted list rather than a set of `assert.ok(x in api)` checks.
 *
 * 🚨 BOTH ENTRY POINTS, and that is the whole lesson rather than thoroughness. `TASKS_DIR` and
 * `RECORD_DIRS` became public API by being added to `lib/schema.js`, which `lib/index.js`
 * re-exports with `export *` and `package.json` publishes again as `diarie/schema`. Nothing went
 * red. An allowlist over `lib/index.js` alone would not have caught it either — the names were
 * reachable through the door it was watching, but they were WRITTEN through the other one. A
 * guard on one entry point guards one entry point.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import * as api from '../lib/index.js';
import * as schema from 'diarie/schema';

/**
 * Everything `import { … } from 'diarie'` may resolve.
 *
 * Adding a line here is the deliberate act of publishing something. Before you do: a consumer
 * may depend on it forever, and removing it later is a breaking change. `lib/index.js` records
 * what is deliberately absent and why — `initStore` above all, which VISION.md keeps internal
 * so that this package does not become the owner of your data.
 */
const PUBLIC_API = [
  // the schema vocabulary, re-exported wholesale from `diarie/schema`
  'ID_RE', 'IS_RATCHETING_TYPE', 'LEGACY_TRACKER_DIRS', 'PRIORITY_RANK', 'RECORD_DIRS',
  'REQUIRED_FIELDS', 'STRING_FIELDS', 'TASKS_DIR', 'TRACKER_DIRS', 'TRACKER_LABEL',
  'VALID_ERROR_CODES', 'VALID_PRIORITIES', 'VALID_STATUSES', 'VALID_TYPES',
  'defaultTrackerDir', 'isAnyStoreDir', 'isNil', 'isPriority', 'isStatus', 'isTaskType',
  'isTrackerDir', 'nsId',

  // the error taxonomy
  'InputError', 'NoStoreError', 'PluginStoreError', 'TwoStoresError',

  // the store layer
  'listTaskFiles', 'loadTasks', 'loadTasksWithWarnings', 'loadedTaskToTask',
  'resolveInitRoot', 'resolveRoot', 'slugOf', 'trackerDirIn',

  // the computations, and the renderers that make their output printable
  'attentionLine', 'blockedLine', 'computeReady', 'computeStats', 'formatStats', 'line',
  'lintTasks',
];

/**
 * Everything `import { … } from 'diarie/schema'` may resolve.
 *
 * A SEPARATE list, not a filter of the one above, even though every name here also appears
 * there. Deriving it would make the two agree by construction and prove nothing — the accident
 * this file exists to prevent was a name entering BOTH at once through a star-export.
 */
const PUBLIC_SCHEMA = [
  'ID_RE', 'IS_RATCHETING_TYPE', 'LEGACY_TRACKER_DIRS', 'PRIORITY_RANK', 'RECORD_DIRS',
  'REQUIRED_FIELDS', 'STRING_FIELDS', 'TASKS_DIR', 'TRACKER_DIRS', 'TRACKER_LABEL',
  'VALID_ERROR_CODES', 'VALID_PRIORITIES', 'VALID_STATUSES', 'VALID_TYPES',
  'defaultTrackerDir', 'isAnyStoreDir', 'isNil', 'isPriority', 'isStatus', 'isTaskType',
  'isTrackerDir', 'nsId',
];

describe('the published surface is an allowlist, not an accident', () => {
  it('`diarie` exports exactly the approved names', () => {
    assert.deepEqual(
      Object.keys(api).sort(),
      [...PUBLIC_API].sort(),
      'the public API changed — if that was deliberate, update PUBLIC_API and say so in the commit'
    );
  });

  it('`diarie/schema` exports exactly the approved names', () => {
    // Imported through the PACKAGE specifier, not by relative path, so this exercises the
    // `exports` map itself. A subpath that stopped resolving would fail here rather than
    // silently falling back to a file the map does not publish.
    assert.deepEqual(
      Object.keys(schema).sort(),
      [...PUBLIC_SCHEMA].sort(),
      'the `diarie/schema` subpath changed — this is the door TASKS_DIR/RECORD_DIRS went through'
    );
  });

  it('every schema name is reachable from the main entry point too', () => {
    // Not a restatement of the two lists: it pins the RELATIONSHIP. `lib/index.js` re-exports
    // schema with `export *`, so a consumer may import these from either. If that star ever
    // narrows, this says so — rather than a consumer discovering it at runtime.
    const missing = PUBLIC_SCHEMA.filter(name => !PUBLIC_API.includes(name));
    assert.deepEqual(missing, [], `published by diarie/schema but not by diarie: ${missing.join(', ')}`);
  });

  it('keeps the store WRITER internal', () => {
    // The one absence worth asserting rather than merely listing. `initStore` creates a store,
    // and VISION.md refuses a CRUD layer on the grounds that it would make diarie the owner of
    // your data. The bin may write; publishing the writer is how the refused layer arrives.
    assert.ok(!('initStore' in api), 'initStore must not be published — see VISION.md on CRUD');
    assert.ok(!('ResultError' in api), 'ResultError is thrown only after a command printed its answer');
  });
});
