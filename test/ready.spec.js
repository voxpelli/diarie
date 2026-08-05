/**
 * Unit tests for the ready walk (computeReady / computeStats / nsId).
 *
 * Pure functions tested with inline task arrays — no file IO.
 *
 * Imported by package name, not by relative path: these assert the *published*
 * contract (`exports["."]`), which is the thing that ships. A self-reference
 * resolves through `exports` under moduleResolution node16.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { computeReady, computeStats, nsId } from 'diarie';

/**
 * @import { GlobalId, Priority, Status, TaskType } from '../lib/index.js'
 * @import { Task } from '../lib/store/load-tasks.js'
 */

/**
 * Mint a fixture id.
 *
 * `nsId()` is the only thing that mints a `GlobalId` in production, and it always
 * NAMESPACES (`T-1` → `alpha/T-1`). These fixtures deliberately use BARE ids: the walk
 * requires only ONE CONSISTENT id-space, not a particular one, and bare ids keep the
 * cases legible. So the brand is applied by hand — here, in a fixture, which is the one
 * place entitled to.
 *
 * The brand still earns its keep everywhere else: it is what stops production code
 * globalizing `id` in one place and forgetting `parent` in another, which is the bug it
 * exists for.
 *
 * @param {string} id
 * @returns {GlobalId}
 */
const gid = (id) => /** @type {GlobalId} */ (id);

/**
 * A LOADED task, as `loadTasks` would hand it to the walk.
 *
 * `deps` is required on `Task` (the loader always sets it, empty or not), so a fixture
 * that omits it is not a thing the walk can ever receive. Defaulting it here keeps the
 * cases readable without lying about the type.
 *
 * @param {object} row
 * @param {string} row.id
 * @param {Status} row.status
 * @param {TaskType} [row.type]
 * @param {Priority} [row.priority]
 * @param {string[]} [row.deps]
 * @param {string} [row.parent]
 * @param {string[]} [row.labels]
 * @param {string} [row.updated]
 * @returns {Task}
 */
const task = ({ deps = [], id, parent, ...rest }) => /** @type {Task} */ ({
  // The cast is on the OUTPUT only. Spreading `...rest` widens each optional to
  // `T | undefined`, which `exactOptionalPropertyTypes` rejects — a quirk of the spread,
  // not of the data. The INPUT stays fully type-checked, and that is the half that
  // matters: it is what refuses a bad `status`, a bad `type`, or a missing `id`.
  ...rest,
  id: gid(id),
  deps: deps.map(d => gid(d)),
  ...(parent === undefined ? {} : { parent: gid(parent) }),
});

/**
 * A DELIBERATELY malformed row.
 *
 * The robustness cases feed the walk values the schema forbids — that is their whole
 * point, and they cannot be built by `task()` because `task()` type-checks. The cast is
 * the assertion: this is NOT a valid Task, and the walk must survive it anyway.
 *
 * @param {Record<string, unknown>} row
 * @returns {Task}
 */
const bad = (row) => /** @type {Task} */ (/** @type {unknown} */ (row));

describe('computeReady', () => {
  it('pending with no deps is ready', () => {
    assert.equal(computeReady([task({ id: 'T-1', status: 'pending', type: 'task' })]).ready.length, 1);
  });

  it('pending whose only dep is completed is ready', () => {
    assert.ok(computeReady([
      task({ id: 'T-1', status: 'completed', type: 'task' }),
      task({ id: 'T-2', status: 'pending', type: 'task', deps: ['T-1'] }),
    ]).ready.some(t => t.id === 'T-2'));
  });

  it('pending dep blocks (T-2 blocked, not ready)', () => {
    const r = computeReady([
      task({ id: 'T-1', status: 'pending', type: 'task' }),
      task({ id: 'T-2', status: 'pending', type: 'task', deps: ['T-1'] }),
    ]);
    assert.ok(r.blocked.some(t => t.id === 'T-2') && !r.ready.some(t => t.id === 'T-2'));
  });

  it('blocked task records its blocker id', () => {
    const r = computeReady([
      task({ id: 'T-1', status: 'pending', type: 'task' }),
      task({ id: 'T-2', status: 'pending', type: 'task', deps: ['T-1'] }),
    ]);
    assert.equal(r.blocked.find(t => t.id === 'T-2')?.blockers.includes('T-1'), true);
  });

  it('in_progress dep blocks', () => {
    assert.ok(computeReady([
      task({ id: 'T-1', status: 'in_progress', type: 'task' }),
      task({ id: 'T-2', status: 'pending', type: 'task', deps: ['T-1'] }),
    ]).blocked.some(t => t.id === 'T-2'));
  });

  it('failed dep → needs attention, not ready/blocked', () => {
    const r = computeReady([
      task({ id: 'T-1', status: 'failed', type: 'task' }),
      task({ id: 'T-2', status: 'pending', type: 'task', deps: ['T-1'] }),
    ]);
    assert.ok(r.needsAttention.some(t => t.id === 'T-2') && !r.ready.length && !r.blocked.length);
  });

  it('deferred dep → needs attention, not ready/blocked (deferred never resolves a dep)', () => {
    const r = computeReady([
      task({ id: 'T-1', status: 'deferred', type: 'task' }),
      task({ id: 'T-2', status: 'pending', type: 'task', deps: ['T-1'] }),
    ]);
    assert.ok(r.needsAttention.some(t => t.id === 'T-2' && t.reason.includes('deferred')) && !r.ready.length && !r.blocked.length);
  });

  it('a deferred task is never ready (only pending is)', () => {
    assert.equal(computeReady([task({ id: 'T-1', status: 'deferred', type: 'task' })]).ready.length, 0);
  });

  it('missing dep → needs attention', () => {
    assert.ok(computeReady([task({ id: 'T-2', status: 'pending', type: 'task', deps: ['T-99'] })]).needsAttention.some(t => t.reason.includes('missing')));
  });

  it('in_progress task is not ready (only pending is)', () => {
    assert.equal(computeReady([task({ id: 'T-1', status: 'in_progress', type: 'task' })]).ready.length, 0);
  });

  it('ready is sorted by priority (critical before low)', () => {
    const r = computeReady([
      task({ id: 'T-low', status: 'pending', type: 'task', priority: 'low' }),
      task({ id: 'T-crit', status: 'pending', type: 'task', priority: 'critical' }),
    ]);
    assert.equal(r.ready[0]?.id, 'T-crit');
  });
});

describe('computeReady — type gate (decision vp-beads-etm)', () => {
  it('a pending doc is never ready', () => {
    assert.equal(computeReady([task({ id: 'D-1', status: 'pending', type: 'doc' })]).ready.length, 0);
  });

  it('a pending decision is never ready', () => {
    assert.equal(computeReady([task({ id: 'DEC-1', status: 'pending', type: 'decision' })]).ready.length, 0);
  });

  it('a pending milestone is never ready', () => {
    assert.equal(computeReady([task({ id: 'M-1', status: 'pending', type: 'milestone' })]).ready.length, 0);
  });

  it('a pending doc is never blocked or needs-attention either — it is simply excluded', () => {
    const r = computeReady([task({ id: 'D-1', status: 'pending', type: 'doc', deps: ['T-99'] })]);
    assert.ok(r.ready.length === 0 && r.blocked.length === 0 && r.needsAttention.length === 0);
  });

  it('a pending task is unaffected by sibling non-task items in the same list', () => {
    const r = computeReady([
      task({ id: 'T-1', status: 'pending', type: 'task' }),
      task({ id: 'D-1', status: 'pending', type: 'doc' }),
      task({ id: 'M-1', status: 'pending', type: 'milestone' }),
    ]);
    assert.ok(r.ready.length === 1 && r.ready[0]?.id === 'T-1');
  });
});

// These cover the RULE. They cannot cover the bug that made the rule necessary: the
// half-globalized `parent` in loadTasks. Inline arrays let the author write `id` and
// `parent` in one consistent id-space by hand — exactly the coherence the real loader was
// failing to provide. So every assertion below WOULD STAY GREEN against a tracker that
// still hands out a raw `parent` and therefore still offers every epic as work. Verified
// by mutation, not assumed. The regression guard lives in cli.spec.js, which goes through
// loadTasks and a real store on disk. Do not move it here.
describe('computeReady — containers (vp-beads-epc)', () => {
  it('a parent with an OPEN child is not ready — it is blocked BY that child', () => {
    const r = computeReady([
      task({ id: 'P', status: 'pending', type: 'task' }),
      task({ id: 'C', status: 'pending', type: 'task', parent: 'P' }),
    ]);
    assert.ok(!r.ready.some(t => t.id === 'P') &&
      r.blocked.find(t => t.id === 'P')?.children?.includes('C') === true);
  });

  it('the CHILD stays ready (you work the children, not the container)', () => {
    assert.ok(computeReady([
      task({ id: 'P', status: 'pending', type: 'task' }),
      task({ id: 'C', status: 'pending', type: 'task', parent: 'P' }),
    ]).ready.some(t => t.id === 'C'));
  });

  it('children go in `children`, never in `blockers` (a dep must FINISH FIRST; a child is CONTAINED)', () => {
    const p = computeReady([
      task({ id: 'P', status: 'pending', type: 'task' }),
      task({ id: 'C', status: 'pending', type: 'task', parent: 'P' }),
    ]).blocked.find(t => t.id === 'P');
    assert.ok(p?.blockers.length === 0 && p?.children?.length === 1);
  });

  it('a parent whose children are ALL completed is ready again (only OPEN children contain work)', () => {
    assert.ok(computeReady([
      task({ id: 'P', status: 'pending', type: 'task' }),
      task({ id: 'C', status: 'completed', type: 'task', parent: 'P' }),
    ]).ready.some(t => t.id === 'P'));
  });

  // The DECLARATIVE predicate, isolated from the structural one. In the live store these
  // two always co-occur (vp-beads-l9i is epic-labelled AND has open children), so a fix
  // that never implements this check would still look correct there.
  it('an `epic`-labelled task with NO children is never ready — it needs attention', () => {
    const r = computeReady([task({ id: 'E', status: 'pending', type: 'task', labels: ['epic'] })]);
    assert.ok(r.ready.length === 0 && /no open children/.test(r.needsAttention[0]?.reason ?? ''));
  });

  it('an `epic`-labelled task whose children are all completed still is not ready (close it, do not work it)', () => {
    const r = computeReady([
      task({ id: 'E', status: 'pending', type: 'task', labels: ['epic'] }),
      task({ id: 'C', status: 'completed', type: 'task', parent: 'E' }),
    ]);
    assert.ok(!r.ready.some(t => t.id === 'E') && r.needsAttention.some(t => t.id === 'E'));
  });

  it('an in_progress child still counts as OPEN (a claimed child is not a finished one)', () => {
    assert.ok(computeReady([
      task({ id: 'P', status: 'pending', type: 'task' }),
      task({ id: 'C', status: 'in_progress', type: 'task', parent: 'P' }),
    ]).blocked.some(t => t.id === 'P'));
  });

  it('a task can be blocked by deps AND by children at once, reported separately', () => {
    const p = computeReady([
      task({ id: 'D', status: 'pending', type: 'task' }),
      task({ id: 'P', status: 'pending', type: 'task', deps: ['D'] }),
      task({ id: 'C', status: 'pending', type: 'task', parent: 'P' }),
    ]).blocked.find(t => t.id === 'P');
    assert.ok(p?.blockers.includes('D') === true && p?.children?.includes('C') === true);
  });

  it('a CANCELLED child does not entomb its parent in `blocked` — it needs a human, like a cancelled DEP', () => {
    const r = computeReady([
      task({ id: 'P', status: 'pending', type: 'task' }),
      task({ id: 'C', status: 'cancelled', type: 'task', parent: 'P' }),
    ]);
    // The bug this pins: "open child" was once `status !== 'completed'`, which swept the
    // terminal statuses into ACTIVE and left the parent blocked forever, by a dead child,
    // in the bucket nobody reads. A cancelled DEP had always routed to needsAttention.
    assert.ok(!r.blocked.some(t => t.id === 'P') && r.needsAttention.some(t => t.id === 'P' && /cancelled/.test(t.reason)));
  });

  it('a MILESTONE child never blocks its parent (it is never worked, so it never completes)', () => {
    const r = computeReady([
      task({ id: 'P', status: 'pending', type: 'task' }),
      task({ id: 'M', status: 'pending', type: 'milestone', parent: 'P' }),
    ]);
    // A milestone lives in tasks-*.yml (unlike a decision), has "no effort, no assignment",
    // and therefore never reaches `completed`. Counting it as an open child would have held
    // its parent hostage forever.
    assert.ok(r.ready.some(t => t.id === 'P'));
  });

  it('a DANGLING parent surfaces the child (the tripwire for an id-space divergence)', () => {
    const r = computeReady([task({ id: 'C', status: 'pending', type: 'task', parent: 'NOPE' })]);
    // If `id` and `parent` ever fall into different id-spaces again, EVERY parent dangles
    // and every row lands here at once — instead of every epic silently becoming workable.
    assert.ok(!r.ready.some(t => t.id === 'C') && r.needsAttention.some(t => /parent NOPE \(missing\)/.test(t.reason)));
  });
});

describe('computeStats', () => {
  const tasks = [
    task({ id: 'T-1', status: 'completed', type: 'task', priority: 'high' }),
    task({ id: 'T-2', status: 'pending', type: 'task', labels: ['bug'], priority: 'medium' }),
    task({ id: 'T-3', status: 'pending', type: 'task', priority: 'low', deps: ['T-2'] }),
    task({ id: 'T-4', status: 'in_progress', type: 'task', labels: ['feature'], priority: 'high', updated: '2026-01-01' }),
  ];
  const s = computeStats(tasks, 30, new Date('2026-06-09T00:00:00Z'));

  it('stats total counts all tasks', () => {
    assert.equal(s.total, 4);
  });

  it('stats byStatus tallies', () => {
    assert.ok(s.byStatus['pending'] === 2 && s.byStatus['completed'] === 1 && s.byStatus['in_progress'] === 1);
  });

  it('stats ready counts only unblocked pending', () => {
    assert.equal(s.ready, 1); // T-2 ready, T-3 blocked by T-2
  });

  it('stats blocked counts blocked pending', () => {
    assert.equal(s.blocked, 1);
  });

  it('stats flags an old in_progress task as stale', () => {
    assert.ok(s.stale.includes('T-4'));
  });

  it('stats does not flag a recent task as stale', () => {
    assert.ok(!computeStats(tasks, 30, new Date('2026-01-15T00:00:00Z')).stale.includes('T-4'));
  });
});

describe('computeStats — robustness', () => {
  it('a malformed updated date lands in malformedDates, not stale', () => {
    const s = computeStats([task({ id: 'T-x', status: 'in_progress', updated: 'yesterday' })], 30, new Date('2026-06-09T00:00:00Z'));
    assert.ok(s.malformedDates.includes('T-x') && !s.stale.includes('T-x'));
  });

  it('a prototype-name status does not pollute byStatus', () => {
    // `bad()`, not `task()`: `toString` is not a Status, and that is the entire point —
    // the row is a prototype-pollution probe. `task()` REFUSES to build it, which is
    // `task()` working; the cast is how the test says "yes, I mean an invalid row".
    const s = computeStats([bad({ id: 'T-x', status: 'toString', type: 'task', priority: 'medium' })], 30, new Date('2026-06-09T00:00:00Z'));
    assert.ok(!('toString' in s.byStatus));
  });
});

describe('nsId', () => {
  it('nsId namespaces a bare id', () => {
    assert.equal(nsId('T-1', 'alpha'), 'alpha/T-1');
  });

  it('nsId passes through a slug-qualified id', () => {
    assert.equal(nsId('beta/T-2', 'alpha'), 'beta/T-2');
  });

  it('nsId stringifies a numeric id', () => {
    assert.equal(nsId(1, 'alpha'), 'alpha/1');
  });
});

describe('computeReady — cross-file & self-cycle', () => {
  it('a cross-file (slug/id) dep on a completed task is ready', () => {
    assert.ok(computeReady([
      task({ id: 'a/T-1', status: 'completed', type: 'task' }),
      task({ id: 'b/T-2', status: 'pending', type: 'task', deps: ['a/T-1'] }),
    ]).ready.some(t => t.id === 'b/T-2'));
  });

  it('a self-dependent task is blocked, not ready (no infinite loop)', () => {
    const r = computeReady([task({ id: 'a/T-1', status: 'pending', type: 'task', deps: ['a/T-1'] })]);
    assert.ok(r.blocked.some(t => t.id === 'a/T-1') && !r.ready.length);
  });
});

describe('a row with NO USABLE STATUS is surfaced, not dropped', () => {
  // The loader omits `status` when the YAML said something the schema does not know, so
  // `undefined` here is exactly what a real store produces for `status: totally-bogus`.
  // These assert on `computeReady` DIRECTLY, which is what the CLI-level `--strict` cases
  // cannot do: there the loader's warning and this attention entry both force exit 2, so a
  // green exit code cannot tell you which route produced it.

  it('lands in needsAttention rather than in no partition at all', () => {
    const r = computeReady([bad({ id: 'backlog/T-1', title: 'no usable status', type: 'task', deps: [] })]);

    assert.equal(r.ready.length, 0);
    assert.equal(r.blocked.length, 0);
    assert.equal(r.needsAttention.length, 1);
    // The REASON must name the field and the consequence — a guard that drops must report.
    assert.match(r.needsAttention[0]?.reason ?? '', /status/);
  });

  it('does NOT surface a non-task type, which is excluded silently and correctly', () => {
    // The gate that keeps the type model intact: a decision is not work whatever its status
    // says, so a broken one must not appear in a partition that only describes work. Without
    // this, the fix above would have quietly widened needsAttention to every record type.
    const r = computeReady([bad({ id: 'backlog/D-1', title: 'a decision', type: 'decision', deps: [] })]);

    assert.equal(r.needsAttention.length, 0);
    assert.equal(r.ready.length, 0);
  });

  it('an UNKNOWN type with no status is still surfaced — we cannot tell it is not work', () => {
    const r = computeReady([bad({ id: 'backlog/T-2', title: 'neither field usable', deps: [] })]);

    assert.equal(r.needsAttention.length, 1);
  });

  it('a valid row beside it is unaffected', () => {
    // Falsification for the three above: if the new branch swallowed the loop, this goes red.
    const r = computeReady([
      bad({ id: 'backlog/T-1', title: 'no usable status', type: 'task', deps: [] }),
      task({ id: 'T-2', status: 'pending', type: 'task' }),
    ]);

    assert.equal(r.ready.length, 1);
    // `gid()` is identity in this suite, so the id is bare — the namespacing happens in the
    // loader, which these unit tests deliberately do not go through.
    assert.equal(r.ready[0]?.id, 'T-2');
  });

  it('renders as a WORD in a blocker line, never as an empty parenthesis', () => {
    // `${undefined}` would print "undefined" and an empty string would print `T-1 ()`, where
    // the parenthesis is the only evidence anything is wrong. A stalled CHILD is the path that
    // interpolates a status, so the parent's line is where this shows.
    const r = computeReady([
      task({ id: 'T-1', status: 'pending', type: 'task' }),
      bad({ id: 'backlog/T-2', title: 'child with no usable status', type: 'task', parent: 'backlog/T-1', deps: [] }),
    ]);

    const line = JSON.stringify(r);
    assert.doesNotMatch(line, /\(undefined\)/);
    assert.doesNotMatch(line, /\(\)/);
  });
});
