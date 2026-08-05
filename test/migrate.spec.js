/**
 * Unit tests for the bd → flat-YAML migrator.
 *
 * This suite exists because the migrator stopped being a one-shot: `/migrate-tracker`
 * runs it against sibling repos, and its failure mode is SILENT DATA LOSS (a body
 * that parses wrong drops its acceptance criteria without erroring), not a crash.
 * Every case below is a bug that actually bit, or a generalization the vp-beads
 * migration could never have exercised.
 *
 * NOTE the characterization test that guards the whole pipeline is NOT here — it
 * is a one-time proof recorded in the commit: the generalized migrator, given
 * vp-beads's parameters, reproduces the original 24-issue migration byte-for-byte.
 * These tests cover what that diff structurally cannot: repos unlike vp-beads.
 *
 * The CLI guards below drive a SYNTHETIC export (test/fixtures/bd-export.jsonl), not
 * the plugin's frozen archive. The archive lives outside this package and would not
 * survive extraction — a test that reads it is a test the standalone package cannot
 * run. The synthetic file is richer besides: it carries every TYPE_MAP entry, both
 * edge-drop paths, an unmappable priority and the escaped-newline body, which the real
 * export only partly did.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { env } from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import {
  after, before, describe, it,
} from 'node:test';

import { load } from 'js-yaml';

import {
  CONSUMED_BD_FIELDS, parseBdExport, projectRecords, TYPE_MAP,
} from '../lib/migrate/bd-map.js';
import {
  groupTasks, MIGRATE_OPTIONS, normalizeBody, PLACED_BY, projectLive, splitBody, USAGE,
} from '../lib/migrate/bootstrap.js';

/** @import { TestContext } from 'node:test' */
/** @import { BdIssue } from '../lib/migrate/bd-map.js' */
/** @import { TaskRow } from '../lib/schema.js' */

/**
 * A minimal bd issue, with per-case overrides merged on top.
 *
 * @param {Partial<BdIssue>} [over] fields to override on the base issue
 * @returns {BdIssue} a bd-shaped issue record
 */
const issue = (over) => ({ id: 'p-1', title: 't', status: 'open', issue_type: 'task', priority: 2, ...over });

describe('splitBody', () => {
  it('extracts AC bullets and keeps the rest as description', () => {
    const { acceptanceCriteria, description } = splitBody('Intro.\n\n## Acceptance Criteria\n\n- one\n- two\n');
    assert.ok(acceptanceCriteria.join('|') === 'one|two' && description === 'Intro.');
  });

  it('escaped-newline body (8d5): AC still extracted, not silently dropped', () => {
    // The vp-beads-8d5 bug: the body stored literal backslash-n, so the heading was
    // never line-anchored and the AC vanished with no error. Cost 1 of 10 carriers.
    const { acceptanceCriteria } = splitBody(String.raw`Intro.\n\n## Acceptance Criteria\n\n- one\n- two`);
    assert.equal(acceptanceCriteria.join('|'), 'one|two');
  });

  it('AC section ends at the next ## heading', () => {
    const { acceptanceCriteria, description } = splitBody('## Acceptance Criteria\n- a\n\n## Notes\nkeep me');
    assert.ok(acceptanceCriteria.join('|') === 'a' && description === '## Notes\nkeep me');
  });

  it('strips task-list checkbox markers', () => {
    const { acceptanceCriteria } = splitBody('## Acceptance Criteria\n- [ ] unchecked\n- [x] checked');
    assert.equal(acceptanceCriteria.join('|'), 'unchecked|checked');
  });

  it('no AC heading: empty list, body preserved', () => {
    const { acceptanceCriteria, description } = splitBody('Just a body.');
    assert.ok(acceptanceCriteria.length === 0 && description === 'Just a body.');
  });
});

describe('normalizeBody', () => {
  it('normalizeBody un-escapes literal backslash-n (the decision path needs it too)', () => {
    // The DECISION path never got the normalization the TASK path had — and a decision is
    // ENTIRELY prose, so its whole payload rendered as one line of `\n` gibberish. vp-beads
    // never saw it: its 6 decisions didn't carry the artifact and its 1 artifact-carrying
    // issue was a task. Only a sibling repo would have hit it.
    const out = normalizeBody(String.raw`## Decision\nWe chose X.\n\n## Rationale\nBecause Y.`);
    assert.ok(out.includes('\n## Rationale') && !out.includes('\\n'));
  });

  it('normalizeBody tolerates an absent body', () => {
    assert.equal(normalizeBody(), '');
  });
});

describe('projectLive (edges to non-live issues)', () => {
  const liveIds = new Set(['p-1', 'p-live']);

  it('a blocks-dep on a CLOSED issue is dropped, not dangled', () => {
    /** @type {string[]} */
    const dropped = [];
    const t = projectLive(issue({ dependencies: [{ depends_on_id: 'p-closed', type: 'blocks' }] }), liveIds, dropped);
    assert.ok(t.deps === undefined && dropped.length === 1 && dropped[0]?.includes('blocks'));
  });

  it('a blocks-dep on a LIVE issue is kept', () => {
    /** @type {string[]} */
    const dropped = [];
    const t = projectLive(issue({ dependencies: [{ depends_on_id: 'p-live', type: 'blocks' }] }), liveIds, dropped);
    assert.ok(t.deps?.join(',') === 'p-live' && dropped.length === 0);
  });

  it('a parent-child edge to a CLOSED epic is dropped, not dangled', () => {
    // vp-beads never hit this — every one of its parents was still live. A sibling
    // repo with a COMPLETED epic would emit a dangling parent and fail validate.
    /** @type {string[]} */
    const dropped = [];
    const t = projectLive(issue({ dependencies: [{ depends_on_id: 'p-closed', type: 'parent-child' }] }), liveIds, dropped);
    assert.ok(t.parent === undefined && dropped.length === 1 && dropped[0]?.includes('parent'));
  });

  it('a parent-child edge to a LIVE epic is kept', () => {
    /** @type {string[]} */
    const dropped = [];
    const t = projectLive(issue({ dependencies: [{ depends_on_id: 'p-live', type: 'parent-child' }] }), liveIds, dropped);
    assert.ok(t.parent === 'p-live' && dropped.length === 0);
  });
});

describe('projectLive (type / status / priority mapping)', () => {
  const liveIds = new Set(['p-1', 'p-live']);

  it('deferred survives as deferred (the spike approximated it to cancelled)', () => {
    assert.equal(projectLive(issue({ status: 'deferred' }), liveIds, []).status, 'deferred');
  });

  it('a bd framing (bug) collapses to type=task + a label', () => {
    const t = projectLive(issue({ issue_type: 'bug' }), liveIds, []);
    assert.ok(t.type === 'task' && t.labels?.includes('bug'));
  });

  it('decision stays its own type (it is routed to decisions/, not a task row)', () => {
    assert.equal(projectLive(issue({ issue_type: 'decision' }), liveIds, []).type, 'decision');
  });

  it('an unmapped priority defaults to medium rather than emitting an invalid enum', () => {
    assert.equal(projectLive(issue({ priority: 99 }), liveIds, []).priority, 'medium');
  });

  it('an unknown issue_type throws loudly (never a silently wrong type)', () => {
    assert.throws(() => projectLive(issue({ issue_type: 'nonsense' }), liveIds, []));
  });

  it('an unmapped bd status (reopened) throws, never emits a status-less row', () => {
    // bd has statuses beyond STATUS_MAP's four (`reopened`, …). Unmapped → undefined →
    // js-yaml DROPS the key → a task row with no status. Silent corruption; must throw.
    assert.throws(() => projectLive(issue({ status: 'reopened' }), liveIds, []));
  });
});

describe('projectRecords (the read-only spike — @planned)', () => {
  // The spike's projection is retired-from-use but kept (see its @planned tag). It is where the
  // priority-0 falsy bug lived — `r.priority ? …` treated bd's numeric 0 (critical) as absent —
  // so its mapping stays pinned: bd priority is 0–4 and 0 IS a value, not a missing one.

  it('bd priority 0 maps to critical, never to the medium default', () => {
    const { tasks } = projectRecords([issue({ priority: 0 })]);
    assert.equal(tasks[0]?.priority, 'critical');
  });

  it('absent priority defaults to medium AND is reported in the loss', () => {
    // The `priority` key is omitted entirely: an explicit `undefined` is not assignable to
    // `BdIssue` under exactOptionalPropertyTypes, and an absent key is the honest input anyway.
    const { loss, tasks } = projectRecords([{ id: 'p-1', title: 't', status: 'open', issue_type: 'task' }]);
    assert.equal(tasks[0]?.priority, 'medium');
    const reported = /** @type {{ priorityDefaultedIds: Array<{ id: string }> }} */ (loss).priorityDefaultedIds;
    assert.ok(reported.some(({ id }) => id === 'p-1'));
  });
});

/**
 * A migrated task row. Only `id` and `parent` steer the routing, but the row must
 * still BE a row — the type is what says so, and the spec files are type-checked.
 *
 * @param {string} id
 * @param {string} [parent]
 * @returns {TaskRow}
 */
const row = (id, parent) => ({ id, title: id, status: 'pending', type: 'task', ...(parent ? { parent } : {}) });

/**
 * The epic, a child, a GRANDchild (must follow the epic transitively), and an outsider.
 *
 * @returns {TaskRow[]}
 */
const tree = () => [row('e-1'), row('c-1', 'e-1'), row('g-1', 'c-1'), row('o-1')];

describe('groupTasks (slug routing)', () => {
  const epicSlugs = new Map([['e-1', 'migration']]);

  it('the epic, its child, AND its grandchild land in the epic slug', () => {
    const g = groupTasks(tree(), epicSlugs, 'backlog');
    assert.equal(g.get('migration')?.map(t => t.id).join(','), 'e-1,c-1,g-1');
  });

  it('an unparented task falls to the default slug', () => {
    const g = groupTasks(tree(), epicSlugs, 'backlog');
    assert.equal(g.get('backlog')?.map(t => t.id).join(','), 'o-1');
  });

  it('no --epic given: everything lands in one default-slug file', () => {
    const g = groupTasks([row('o-1')], new Map(), 'backlog');
    assert.ok(g.size === 1 && g.get('backlog')?.length === 1);
  });

  it('a parent cycle terminates and falls to the default slug', () => {
    // A malformed export could carry a parent cycle; routing must terminate.
    const g = groupTasks([row('a', 'b'), row('b', 'a')], epicSlugs, 'backlog');
    assert.equal(g.get('backlog')?.length, 2);
  });

  it('an --epic with no live members yields an empty (still-written) slug', () => {
    assert.equal(groupTasks([row('o-1')], epicSlugs, 'backlog').get('migration')?.length, 0);
  });
});

const SCRIPT = fileURLToPath(new URL('../lib/migrate/bootstrap.js', import.meta.url));
const EXPORT = fileURLToPath(new URL('fixtures/bd-export.jsonl', import.meta.url));

/**
 * Run the migrator CLI against the synthetic export.
 *
 * `out` is the two streams CONCATENATED, and that is exactly why the channel-policy bug it
 * hides went unnoticed: a helper that flattens stdout and stderr into one string cannot fail
 * when a message moves between them. `stdout`/`stderr` are returned separately so a test can
 * assert WHICH stream carried a fact, not merely that something said it somewhere.
 *
 * @param {string[]} args
 * @param {string} [wd] working dir (to exercise the CWD default)
 * @returns {{ code: number|null, out: string, stderr: string, stdout: string }}
 */
const run = (args, wd) => {
  const r = spawnSync('node', [SCRIPT, EXPORT, ...args], { cwd: wd, encoding: 'utf8' });
  return {
    code: r.status,
    out: (r.stdout ?? '') + (r.stderr ?? ''),
    stderr: r.stderr ?? '',
    stdout: r.stdout ?? '',
  };
};

/**
 * A temp dir that cleans itself up when the test ends.
 *
 * @param {TestContext} t
 * @returns {string}
 */
function tmpDir (t) {
  const dir = mkdtempSync(join(tmpdir(), 'vp-boot-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

describe('CLI guards (the two data-loss stops)', () => {
  // The overwrite guard is STATEFUL — migrate, then re-run, then --force. The three
  // assertions share one store on purpose: the second only means anything because the
  // first populated it. Hence a shared dir and ordered `it`s, not three isolated cases.
  describe('the overwrite guard, in sequence', () => {
    /** @type {string} */
    let dir;
    before(() => { dir = mkdtempSync(join(tmpdir(), 'vp-boot-')); });
    after(() => rmSync(dir, { recursive: true, force: true }));

    it('an empty root migrates cleanly', () => {
      const { code } = run(['--root', dir]);
      assert.ok(code === 0 && existsSync(join(dir, 'diarium', 'tasks', 'tasks-backlog.yml')));
    });

    it('re-running over an existing store refuses (exit 1, names the files)', () => {
      // This is the guard that stands between a re-invocation and every hand-edit made
      // since the cutover.
      const again = run(['--root', dir]);
      assert.ok(again.code === 1 && /refusing to overwrite/.test(again.out) && again.out.includes('tasks-backlog.yml'));
    });

    it('--force overrides the refusal (the deliberate redo path)', () => {
      assert.equal(run(['--root', dir, '--force']).code, 0);
    });
  });

  it('a gitignored ARCHIVE still migrates and is mentioned (policy is the user\'s, not ours)', (t) => {
    // An ignored ARCHIVE is a judgment call — closed issues record what was DONE, which
    // git log/CHANGELOG usually already cover. Say something; do not refuse. Asserted on
    // BEHAVIOUR (migrated + spoke about the archive), not on the exact prose — an earlier
    // version of this test pinned a sentence and broke when the wording improved.
    const dir = tmpDir(t);
    spawnSync('git', ['-C', dir, 'init', '-q']);
    writeFileSync(join(dir, '.gitignore'), '*.jsonl\n');
    const { code, out } = run(['--root', dir]);
    assert.ok(
      code === 0 &&
      existsSync(join(dir, 'diarium', 'tasks', 'tasks-backlog.yml')) &&
      /gitignored/.test(out) && /bd-final-export\.jsonl/.test(out)
    );
    // Same blind spot as the channel-policy sibling, and it was here first: all three archive
    // branches carry the token `gitignored`, so this passed on branch three with branch two
    // destroyed. Tightening rather than rewriting — every assertion above still holds.
    assert.doesNotMatch(out, /NOT gitignored/, 'a different archive branch fired than the one under test');
  });

  it('archive not ignored + bd history never tracked → flagged as a NEW choice', (t) => {
    // Revealed preference: a project that never tracked `.beads/` already decided bd
    // history is not worth versioning. Committing a JSONL of it now would quietly
    // reverse that — so when the archive WOULD commit, say so as a new choice.
    const dir = tmpDir(t);
    spawnSync('git', ['-C', dir, 'init', '-q']);
    const { code, out } = run(['--root', dir]);
    assert.ok(code === 0 && /first time/.test(out));
  });

  it('a gitignored STORE is a hard stop (the backlog itself would not commit)', (t) => {
    // An ignored STORE is not a judgment call — the migration produced nothing durable.
    const dir = tmpDir(t);
    spawnSync('git', ['-C', dir, 'init', '-q']);
    writeFileSync(join(dir, '.gitignore'), 'diarium/\n');
    const { code, out } = run(['--root', dir]);
    assert.ok(code === 1 && /GITIGNORED/.test(out));
  });

  it('a non-git target still migrates (check-ignore absence is not a failure)', (t) => {
    // …but a plain non-git directory must not false-positive.
    assert.equal(run(['--root', tmpDir(t)]).code, 0);
  });

  it('a tasks-*.yaml store also trips the overwrite guard (not just .yml)', (t) => {
    // Both readers accept tasks-*.yaml too, so the guard must match that extension —
    // otherwise a .yaml store is invisible to it and gets clobbered.
    const dir = tmpDir(t);
    mkdirSync(join(dir, 'diarium', 'tasks'), { recursive: true });
    writeFileSync(join(dir, 'diarium', 'tasks', 'tasks-x.yaml'), 'tasks: []\n');
    const { code, out } = run(['--root', dir]);
    assert.ok(code === 1 && /refusing to overwrite/.test(out));
  });

  it('--dotted bootstraps into the other posture', (t) => {
    // A bootstrap is exactly when the posture gets chosen — it is the moment the store
    // first exists. Without this flag migrate would hardcode a choice decision
    // `diarie-pos` puts in the repo's hands.
    const dir = tmpDir(t);
    const { code } = run(['--root', dir, '--dotted']);
    assert.ok(code === 0 && existsSync(join(dir, '.diarium', 'tasks', 'tasks-backlog.yml')));
    assert.ok(!existsSync(join(dir, 'diarium')));
  });

  it('the overwrite guard sees EVERY store name, not just the one this run would write', (t) => {
    // The subtle version of not checking at all. Checking only `diarium/` in a repo whose
    // store is `.diarium/` (or the older `.diarie/`) finds nothing, concludes the project
    // is fresh, and writes a SECOND store beside a backlog full of real work — with the
    // guard still there, still passing, and no longer guarding anything.
    for (const name of ['.diarium', '.diarie']) {
      const dir = tmpDir(t);
      mkdirSync(join(dir, name, 'tasks'), { recursive: true });
      writeFileSync(join(dir, name, 'tasks', 'tasks-backlog.yml'), 'tasks: []\n');
      const { code, out } = run(['--root', dir]);
      assert.ok(code === 1 && /refusing to overwrite/.test(out), `${name}/ did not trip the guard`);
      assert.ok(!existsSync(join(dir, 'diarium')), `${name}/ got a second store written beside it`);
    }
  });

  it('an EMPTY store directory still trips the overwrite guard', (t) => {
    // The guard used to count `tasks-*.yml` files, so a store whose `tasks/` was empty — a
    // fresh `diarie init`, or a project keeping only decisions so far — read as "nothing
    // here" and got a second store written beside it. `init` refuses this exact disk state;
    // two store-creating commands disagreeing about what a store IS is how a repo ends up
    // with two of them.
    const dir = tmpDir(t);
    mkdirSync(join(dir, '.diarium', 'decisions'), { recursive: true });

    const { code, out } = run(['--root', dir]);
    assert.equal(code, 1);
    assert.match(out, /refusing to overwrite/);
    assert.match(out, /no task files/, 'the message must survive having no filenames to list');
    assert.ok(!existsSync(join(dir, 'diarium')), 'wrote a second store beside the empty one');
  });

  it('a bare run (no --root) targets CWD, not the script\'s own repo', (t) => {
    // Without --root the target is CWD, never the plugin checkout — so a forgotten
    // --root cannot clobber the tracker of whatever repo happens to ship this script.
    const dir = tmpDir(t);
    const { code } = run([], dir);
    assert.ok(code === 0 && existsSync(join(dir, 'diarium', 'tasks', 'tasks-backlog.yml')));
  });
});

describe('USAGE ⇔ parser parity (vp-beads-mig)', () => {
  // migrate is the ONE command whose --help is hand-written, not generated by peowly — so its
  // USAGE can silently drift from the flags parseArgs actually accepts, with nothing going red.
  // This asserts the single source, and it is what lets vp-beads-vcb's oracle trust migrate's USAGE.
  it('every flag listed in USAGE is a MIGRATE_OPTIONS key, and vice versa', () => {
    const usageFlags = [...USAGE.matchAll(/^ {2}--([a-z-]+)/gm)].map(m => m[1]).toSorted();
    assert.deepEqual(usageFlags, Object.keys(MIGRATE_OPTIONS).toSorted());
  });
});

const CLI = fileURLToPath(new URL('../cli.js', import.meta.url));

/**
 * The same run, through `cli.js` — the boundary where the `{error, code}`-on-stdout contract
 * is actually produced. `run` above drives `bootstrap.js` directly, which prints a human
 * sentence and has never produced that contract; asserting a `code` against it passes for the
 * wrong reason (see `migrateOne`'s `viaCli`).
 *
 * @param {string[]} args
 * @returns {{ code: number|null, stdout: string, out: string }}
 */
const runCli = (args) => {
  const r = spawnSync('node', [CLI, 'migrate', EXPORT, ...args], { encoding: 'utf8' });
  return { code: r.status, stdout: r.stdout ?? '', out: (r.stdout ?? '') + (r.stderr ?? '') };
};

describe('migrate and the store already on disk (the posture is not the flag\'s to choose)', () => {
  it('--force against a DOTTED store rewrites THAT store, never a second one beside it', (t) => {
    // The whole finding. `storeName` came from `--dotted` alone, so `--force` — documented as
    // "redo a botched migration" — did not overwrite a `.diarium/` store: it created
    // `diarium/` beside it, exited 0, and reported success. The next `diarie ready` in that
    // repo then hard-failed ETWOSTORES with the real backlog unreadable.
    const dir = tmpDir(t);
    assert.equal(run(['--root', dir, '--dotted']).code, 0, 'seeding the dotted store failed');

    // NOTE: no --dotted on the re-run. What is on disk decides.
    const { code, out } = run(['--root', dir, '--force']);

    assert.equal(code, 0);
    assert.ok(existsSync(join(dir, '.diarium', 'tasks', 'tasks-backlog.yml')), 'stopped rewriting the real store');
    // THE assertion — the two above pass on the broken code too.
    assert.ok(!existsSync(join(dir, 'diarium')), 'wrote a SECOND store; `diarie ready` here is now ETWOSTORES');
    assert.match(out, /--force: rewriting the store already at .*\.diarium/, '--force waved something past in silence');
  });

  it('--dotted at a repo whose store is VISIBLE refuses — posture flips with git mv, not a flag', (t) => {
    // Obeying the flag writes a second store; ignoring it drops an explicit instruction
    // without a word. Neither is available, so it refuses and names the rename.
    const dir = tmpDir(t);
    assert.equal(run(['--root', dir]).code, 0, 'seeding the visible store failed');

    const { code, stdout } = runCli(['--root', dir, '--dotted', '--json']);
    const parsed = JSON.parse(stdout);

    assert.equal(code, 1);
    assert.equal(parsed.code, 'EUSAGE');
    assert.match(parsed.error, /already this project's store/);
    assert.ok(!existsSync(join(dir, '.diarium')), 'obeyed --dotted and created a second store');
  });

  it('BOTH forms present: ETWOSTORES, and --force cannot license a guess', (t) => {
    // `--force` answers "overwrite THIS store?". With both forms present there is no "this",
    // so the ambiguity is resolved before the flag is ever read. (It used to surface as
    // EEXIST — "a store is in the way" — about a state whose actual problem is that there
    // are two of them.)
    const dir = tmpDir(t);
    mkdirSync(join(dir, 'diarium', 'tasks'), { recursive: true });
    mkdirSync(join(dir, '.diarium', 'tasks'), { recursive: true });

    const { code, stdout } = runCli(['--root', dir, '--force', '--json']);
    assert.equal(code, 1);
    assert.equal(JSON.parse(stdout).code, 'ETWOSTORES');
  });

  it('a FILE on the store path refuses with EEXIST, not a raw ENOTDIR mid-write', (t) => {
    // `trackerDirIn` rightly refuses to call a plain file a store, so every guard above sees
    // a fresh root and the run reaches `mkdirSync`, which throws ENOTDIR — not an InputError,
    // so cli.js prints a stack trace after human progress text has already landed on stdout,
    // leaving a `--json` caller with unparseable output for a refusal.
    const dir = tmpDir(t);
    writeFileSync(join(dir, 'diarium'), 'not a store\n');

    const { code, stdout } = runCli(['--root', dir, '--json']);
    assert.equal(code, 1);
    assert.equal(JSON.parse(stdout).code, 'EEXIST');
    assert.ok(!existsSync(join(dir, 'diarium', 'tasks')), 'wrote into a path that is a file');
  });

  it('an ignored DIARIUM_ROOT is REPORTED — migrate reads no environment, and says so', (t) => {
    // Deliberate: this is the one command that writes a store from nothing, so the set of
    // things that can aim it stays as small and visible as possible. But "not read" and "not
    // mentioned" are different, and this repo's rule is that a dropped value gets named.
    const dir = tmpDir(t);
    const elsewhere = tmpDir(t);
    const r = spawnSync('node', [SCRIPT, EXPORT, '--root', dir], {
      encoding: 'utf8',
      env: { ...env, DIARIUM_ROOT: elsewhere },
    });

    assert.equal(r.status, 0);
    assert.match(r.stdout, /DIARIUM_ROOT/);
    assert.ok(!existsSync(join(elsewhere, 'diarium')), 'obeyed the environment');
  });
});

describe('a missing input file is an InputError, not a crash (vp-beads-mig)', () => {
  // The archetypal user mistake: point at a file that is not there. It used to reach cli.js as a
  // raw ENOENT and be answered with a stack trace ("unexpected error"); migrate lived outside the
  // boundary. Now readFileSync's ENOENT is converted, so it lands in the same InputError/--json
  // contract as the four peowly commands. Spawned via cli.js, the real boundary.
  //
  // cwd MUST be a store-less temp dir. A bare `migrate` (no --root) targets CWD, and this
  // repository now carries diarie's OWN store at its root (as the extracted repo will
  // too) — so without isolation the EEXIST overwrite-guard fires FIRST and the missing-input case
  // this exercises is never reached. Same isolation the CWD-default test above uses.
  const MISSING = join(tmpdir(), 'diarie-does-not-exist-xyzzy.jsonl');

  it('plain: exit 1, a clear message, and NO stack trace', (t) => {
    const r = spawnSync('node', [CLI, 'migrate', MISSING], { cwd: tmpDir(t), encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /no such bd export file/);
    assert.doesNotMatch(r.stderr, /unexpected error|^\s*at /m);
  });

  it('--json: the error is on STDOUT with the machine code EUSAGE', (t) => {
    const r = spawnSync('node', [CLI, 'migrate', MISSING, '--json'], { cwd: tmpDir(t), encoding: 'utf8' });
    assert.equal(r.status, 1);
    const parsed = JSON.parse(r.stdout);
    assert.equal(parsed.code, 'EUSAGE');
    assert.match(parsed.error, /no such bd export file/);
  });
});

/**
 * Write a one-record export and migrate it into a fresh root.
 *
 * Inline rather than in `fixtures/bd-export.jsonl`: a record carrying an UNACCOUNTED-FOR
 * field makes the migration refuse, which would break every other test sharing that fixture.
 *
 * @param {TestContext} t
 * @param {Record<string, unknown>} issue  merged over a minimal valid bd issue
 * @param {string[]} [args]
 * @param {boolean} [viaCli]  drive `cli.js` rather than the script directly — see below
 * @returns {{ code: number|null, dir: string, out: string, stderr: string, stdout: string }}
 */
function migrateOne (t, issue, args = [], viaCli = false) {
  const dir = tmpDir(t);
  const file = join(dir, 'export.jsonl');
  writeFileSync(file, JSON.stringify({
    _type: 'issue',
    id: 'x-1',
    title: 'T',
    status: 'open',
    issue_type: 'task',
    priority: 2,
    ...issue,
  }) + '\n');
  // `viaCli` is not a convenience. The `{error, code}`-on-stdout contract is produced by
  // cli.js's error boundary, NOT by bootstrap.js — which has its own entry point that prints
  // a human sentence. A `--json` assertion against the script directly tests the wrong thing
  // and passes for the wrong reason. (The same seam confusion put a stack trace on stderr in
  // `init`; see the CLI-boundary note in CLAUDE.md.)
  const entry = viaCli ? CLI : SCRIPT;
  const argv = viaCli ? [entry, 'migrate', file] : [entry, file];
  const r = spawnSync('node', [...argv, '--root', dir, ...args], { encoding: 'utf8' });
  return {
    code: r.status,
    dir,
    out: (r.stdout ?? '') + (r.stderr ?? ''),
    stderr: r.stderr ?? '',
    stdout: r.stdout ?? '',
  };
}

/**
 * The migrated task rows from a store the fixture export produced.
 *
 * @param {string} dir
 * @returns {TaskRow[]}
 */
function rowsIn (dir) {
  const doc = load(readFileSync(join(dir, 'diarium', 'tasks', 'tasks-backlog.yml'), 'utf8'));
  return /** @type {TaskRow[]} */ (
    /** @type {{tasks: unknown}} */ (doc).tasks
  );
}

describe('the field census (transparency: nothing is discarded quietly)', () => {
  // The bug this exists for: `projectLive` read acceptance criteria ONLY out of the markdown
  // body, so bd's standalone `acceptance_criteria` field went straight through to nothing.
  // Against one real export that silently cost 22 of 41 live tasks their criteria — including
  // the project's release gate — while the run exited 0 and `diarie validate` passed after it.

  it('reads acceptance criteria from the STANDALONE field, not only the body', (t) => {
    const dir = tmpDir(t);
    assert.equal(run(['--root', dir]).code, 0);
    const row = rowsIn(dir).find(r => r.id === 'fx-acfl');
    assert.deepEqual(row?.acceptance_criteria, [
      'the standalone field is read',
      'bullets and checkboxes are stripped',
    ]);
  });

  it('UNIONS both sources — neither may clobber the other', (t) => {
    // bd can populate the body section AND the standalone field. Letting one win would just
    // relocate the loss rather than end it.
    const dir = tmpDir(t);
    assert.equal(run(['--root', dir]).code, 0);
    const row = rowsIn(dir).find(r => r.id === 'fx-acbo');
    assert.deepEqual(row?.acceptance_criteria, ['from the body', 'shared line', 'from the field'],
      'expected body-first order, the shared line de-duplicated, and the field-only line kept');
  });

  it('folds `notes` into the description rather than dropping it', (t) => {
    const dir = tmpDir(t);
    assert.equal(run(['--root', dir]).code, 0);
    const row = rowsIn(dir).find(r => r.id === 'fx-acfl');
    assert.match(row?.description ?? '', /## Notes/);
    assert.match(row?.description ?? '', /prose bd keeps outside the description/);
  });

  it('REFUSES on a field it does not account for — including one invented today', (t) => {
    // The load-bearing case. Nobody wrote a rule for `some_future_field`; the census is driven
    // by the keys present in the data, so a bd release (or a foreign tracker) that adds a field
    // surfaces here without this file changing. That is the difference between fixing the bug
    // and closing the class of bug.
    const { code, out } = migrateOne(t, { some_future_field: 'authored content' });
    assert.equal(code, 1);
    assert.match(out, /refusing to migrate/);
    assert.match(out, /some_future_field — 1 record\(s\): x-1/);
  });

  it('a refusal leaves NO TRACE — the next attempt starts from an honest absence', (t) => {
    const { dir } = migrateOne(t, { some_future_field: 'authored content' });
    assert.ok(!existsSync(join(dir, 'diarium')), 'wrote a store despite refusing');
  });

  it('carries the ELOSSY code on the --json channel, as PARSEABLE stdout', (t) => {
    // Asserted through cli.js, and against stdout ALONE. A human line printed before the throw
    // would land in front of the JSON and break `jq` — which is how a refusal comes to read as
    // "no data" to the caller. That happened while writing this test.
    const { code, stdout } = migrateOne(t, { some_future_field: 'x' }, ['--json'], true);
    assert.equal(code, 1);
    assert.equal(JSON.parse(stdout).code, 'ELOSSY');
  });

  it('--lossy proceeds, and still NAMES every field it drops', (t) => {
    const { code, dir, out } = migrateOne(t, { some_future_field: 'x' }, ['--lossy']);
    assert.equal(code, 0);
    assert.match(out, /some_future_field — 1 record\(s\): x-1/);
    assert.ok(existsSync(join(dir, 'diarium', 'tasks', 'tasks-backlog.yml')));
  });

  it('`defer_until` is residue, not silently allowlisted', (t) => {
    // Authored intent ("not before this date") with no home in the schema. It is deliberately
    // absent from IGNORED_BD_FIELDS: when in doubt a field must surface and refuse, because
    // that is the failure direction that can be corrected afterwards.
    assert.equal(migrateOne(t, { defer_until: '2027-01-01' }).code, 1);
  });

  it('bookkeeping fields are reported as knowingly-ignored, and do NOT refuse', (t) => {
    // The counterweight: bd stamps owner/created_at/created_by on every record, so refusing on
    // those would make --lossy mandatory ceremony and strip ELOSSY of all meaning.
    const { code, out } = migrateOne(t, { owner: 'a@b.c', created_by: 'a@b.c', dependency_count: 3 });
    assert.equal(code, 0);
    assert.match(out, /not carried over/);
    assert.match(out, /owner — 1 record\(s\)/);
  });
});

describe('projectLive refuses as an InputError — a foreign export is INPUT, not a crash', () => {
  // THE INVARIANT (lib/utils/errors.js): anything reaching cli.js must be an InputError or a
  // ResultError. All four of projectLive's refusals were `new Error`, so all four landed in the
  // "genuinely unexpected" branch — stack trace on stderr, and NOTHING on stdout. Measured
  // before the fix: `migrate --json` on an unmapped status gave exit 1 with stdout at ZERO
  // BYTES, which a caller cannot tell from ENOSTORE, and `jq` fails on either way.
  //
  // These are the most ordinary things that can happen to this command. bd's own exports carry
  // id/status/issue_type, so only a FOREIGN export was ever bitten — which is exactly the input
  // class this migrator exists to serve.

  /** @type {Array<{ variant: string, over: Record<string, unknown>, error: RegExp }>} */
  const REFUSALS = [
    { variant: 'no id at all', over: { id: undefined }, error: /bd record with no id/ },
    { variant: 'an unusable id', over: { id: true }, error: /unusable id true/ },
    { variant: 'an unmapped status', over: { status: 'frobnicated' }, error: /unmapped bd status/ },
    { variant: 'an unmapped issue_type', over: { issue_type: 'widget' }, error: /unmapped bd issue_type/ },
  ];

  for (const { error, over, variant } of REFUSALS) {
    // Through cli.js, not the script: the `{error, code}`-on-stdout contract is produced at the
    // CLI boundary, so an in-process assertion would pass for the wrong reason.
    it(`${variant}: EUSAGE as parseable JSON on stdout, not a stack trace`, (t) => {
      const { code, stdout } = migrateOne(t, over, ['--json'], true);
      assert.equal(code, 1);

      const parsed = JSON.parse(stdout);
      assert.equal(parsed.code, 'EUSAGE');
      assert.match(parsed.error, error);
    });

    it(`${variant}: refusing leaves NO TRACE of a store`, (t) => {
      const { dir } = migrateOne(t, over);
      assert.ok(!existsSync(join(dir, 'diarium')), 'wrote a store despite refusing');
    });
  }

  it('the enum refusals NAME the vocabulary, so one message is enough to act on', (t) => {
    // An agent holding only this string should not need a second lookup to map its value. The
    // list is DERIVED from STATUS_MAP/TYPE_MAP rather than restated — a hand-written copy is
    // how the message comes to disagree with the map it describes.
    const status = JSON.parse(migrateOne(t, { status: 'frobnicated' }, ['--json'], true).stdout);
    assert.match(status.body, /Accepted bd statuses: closed, deferred, in_progress, open\./);

    const type = JSON.parse(migrateOne(t, { issue_type: 'widget' }, ['--json'], true).stdout);
    assert.match(type.body, /Accepted bd issue types: /);
    // Every TYPE_MAP key, so a map entry that stops being offered to the reader goes red.
    for (const known of Object.keys(TYPE_MAP)) assert.ok(type.body.includes(known), known);
  });

  it('no refusal reaches the unexpected-error branch', (t) => {
    // The tell that distinguishes an owned refusal from a crash, and the one a passing exit code
    // hides: cli.js prefixes the unexpected branch with "unexpected error:" and follows it with a
    // stack. Asserting the ABSENCE of that is what pins the InputError promotion — the exit code
    // is 1 either way.
    for (const { over } of REFUSALS) {
      const { stderr } = migrateOne(t, over, [], true);
      assert.doesNotMatch(stderr, /unexpected error:/);
      assert.doesNotMatch(stderr, /^\s+at /m);
    }
  });
});

describe('CONSUMED IS NOT PLACED: a field the projector names but cannot read', () => {
  // The blind spot this closes, and how it was made: `censusFields` exempts a field from the
  // residue check because the projector claims to read it. The 2026-07-28 fix for lost
  // acceptance criteria added `acceptance_criteria`, `notes` and `design` to that list — and
  // every one of those reads is CONDITIONAL on a shape. So the fix for a silent data loss
  // installed the exemption that made the next one silent, and three comments then promised
  // "the residue census reports this" beside a census that structurally could not.
  //
  // Reproduced before the fix, and it is the founding defect in the migrator's own voice:
  // one record carrying all three as unreadable shapes migrated at EXIT 0, empty stderr, no
  // residue report, no ELOSSY, `diarie validate` clean afterwards — and a row with none of
  // the three fields on it.

  it('all three unreadable at once: refuses, and NAMES every one', (t) => {
    const { code, out } = migrateOne(t, {
      acceptance_criteria: { nested: 'criteria' },
      notes: { a: 'structured' },
      design: ['authored design'],
    });
    assert.equal(code, 1);
    assert.match(out, /refusing to migrate: 3 field\(s\)/);
    assert.match(out, /acceptance_criteria — 1 record\(s\): x-1/);
    assert.match(out, /notes — 1 record\(s\): x-1/);
    assert.match(out, /design — 1 record\(s\): x-1/);
  });

  it('leaves NO TRACE, exactly as an unknown-field refusal does', (t) => {
    const { dir } = migrateOne(t, { notes: { a: 'structured' } });
    assert.ok(!existsSync(join(dir, 'diarium')), 'wrote a store despite refusing');
  });

  // ONE TEST PER PREDICATE. `placesCriteria` and `placesProse` accept different shapes, and a
  // single combined case would let either one be deleted with the other still going red —
  // which is how a reviewer comes to remove "the redundant one" and reopen exactly one bug.

  it('acceptance_criteria: an object is neither a string nor a list, so it is REFUSED', (t) => {
    const { code, out } = migrateOne(t, { acceptance_criteria: { nested: 'criteria' } });
    assert.equal(code, 1);
    assert.match(out, /acceptance_criteria — 1 record\(s\): x-1/);
  });

  it('design: a LIST is refused, because prose is placed only from a string', (t) => {
    // The case that proves the two predicates are not interchangeable: `['authored design']`
    // passes `placesCriteria` and fails `placesProse`, and it is an entirely plausible bd
    // shape. Give both fields one predicate and this record migrates silently again.
    const { code, out } = migrateOne(t, { design: ['authored design'] });
    assert.equal(code, 1);
    assert.match(out, /design — 1 record\(s\): x-1/);
  });

  it('the refusal names the SHAPE to change the value to, not a wrong remedy', (t) => {
    // The old single message told every reader their field had "no home in the store" and to
    // move the content into the description. For this class both halves are false: the field's
    // home exists, and the fix is the shape. A refusal that names the wrong cause is worse
    // than a terser one, because it sends the reader to change the wrong thing.
    const { out } = migrateOne(t, { notes: { a: 'structured' } });
    assert.match(out, /have a home, but not for the shape they carry here/);
    assert.match(out, /notes — 1 record\(s\): x-1 · placed only from a string/);
    assert.doesNotMatch(out, /no home in the store/);
  });

  it('carries ELOSSY on the --json channel, as PARSEABLE stdout', (t) => {
    const { code, stdout } = migrateOne(t, { design: ['authored design'] }, ['--json'], true);
    assert.equal(code, 1);
    assert.equal(JSON.parse(stdout).code, 'ELOSSY');
  });

  it('--lossy proceeds, and still NAMES what it drops', (t) => {
    const { code, dir, out } = migrateOne(t, { notes: { a: 'structured' } }, ['--lossy']);
    assert.equal(code, 0);
    assert.match(out, /notes — 1 record\(s\): x-1/);
    assert.ok(existsSync(join(dir, 'diarium', 'tasks', 'tasks-backlog.yml')));
  });

  // THE COUNTERWEIGHT, and it is the half that keeps this guard from being a regression. A
  // stricter census is only correct if every shape the projector DOES read still migrates —
  // measured over two real exports (43 live issues): `acceptance_criteria` occurs as a string
  // and as a list of strings, `notes` as a string, and nothing else occurs at all.

  it('a readable shape still migrates, and the content still lands in the row', (t) => {
    const { code, dir } = migrateOne(t, {
      acceptance_criteria: ['first', 'second'],
      notes: 'real prose',
    });
    assert.equal(code, 0);

    const row = rowsIn(dir)[0];
    assert.deepEqual(row?.acceptance_criteria, ['first', 'second']);
    assert.match(row?.description ?? '', /## Notes\n\nreal prose/);
  });

  it('a blank list yields nothing but loses nothing, so it does NOT refuse', (t) => {
    // `[]` and `''` never reach the gate — the census's own "carries content" check drops them
    // first. Pinned because the alternative is an ELOSSY on an export where nothing is lost,
    // and a guard that refuses working input is a regression however correct its reasoning.
    assert.equal(migrateOne(t, { acceptance_criteria: [], notes: '', design: '' }).code, 0);
  });

  it('every consumed field declares whether its consumption is CONDITIONAL', () => {
    // THE ANTI-BLINDING DEVICE. Adding a name to CONSUMED_BD_FIELDS is what blinds the census
    // — it is the one edit that silently shrinks what the residue check can see. This makes
    // that edit cost a red test until someone states which class the new field is in, and
    // whether its consumer has a `return []` that needs gating.
    //
    // Driven by `Object.keys`, so a new key with no case here fails rather than defaulting to
    // the quiet answer.
    const UNCONDITIONAL = [
      '_type', 'dependencies', 'description', 'id', 'issue_type',
      'labels', 'priority', 'status', 'title', 'updated_at',
    ];
    const GATED = ['acceptance_criteria', 'design', 'notes'];

    assert.deepEqual(
      Object.keys(CONSUMED_BD_FIELDS).toSorted(),
      [...UNCONDITIONAL, ...GATED].toSorted(),
      'a consumed field is unclassified — say whether its consumer can decline a shape'
    );

    // And the classification has to match the code, not just this list: PLACED_BY is what the
    // census actually consults.
    assert.deepEqual(Object.keys(PLACED_BY).toSorted(), GATED.toSorted());
  });
});

/**
 * Migrate ONE decision record and return the markdown it wrote.
 *
 * @param {import('node:test').TestContext} t
 * @param {Record<string, unknown>} issue
 * @returns {string}
 */
function decisionBody (t, issue) {
  const dir = tmpDir(t);
  const file = join(dir, 'export.jsonl');
  writeFileSync(file, JSON.stringify({
    _type: 'issue',
    id: 'd-1',
    title: 'A decision',
    status: 'open',
    issue_type: 'decision',
    priority: 2,
    ...issue,
  }) + '\n');
  const r = spawnSync('node', [SCRIPT, file, '--root', dir], { encoding: 'utf8' });
  assert.equal(r.status, 0, `migrate failed: ${(r.stdout ?? '') + (r.stderr ?? '')}`);
  return readFileSync(join(dir, 'diarium', 'decisions', 'd-1.md'), 'utf8');
}

describe('the decision WRITE path — a record whose entire content is prose', () => {
  // NOTHING IN THIS SUITE EVER OPENED A FILE UNDER `decisions/` BEFORE, and that is exactly why
  // the bug below survived. `projectLive` composes description + `## Notes` + `## Design` into
  // `task.description`; `dumpDecision` was handed the RAW `r.description` as a SECOND argument
  // and destructured the composed one off. So every migrated decision lost its notes and design
  // — on the happy path, with well-formed string input, at exit 0, with no residue report and no
  // ELOSSY. One-way migration, and a decision is the record type that is nothing BUT prose.
  //
  // The task path was fine throughout, which is what makes the pair below the real assertion:
  // two records, identical `notes`/`design`, differing only in `issue_type`.

  it('carries `notes` and `design` into the body, exactly as the task path does', (t) => {
    const md = decisionBody(t, {
      description: 'We chose YAML.',
      notes: 'Considered TOML and JSON5.',
      design: 'Frontmatter plus a prose body.',
    });

    assert.match(md, /We chose YAML\./);
    assert.match(md, /## Notes/);
    assert.match(md, /Considered TOML and JSON5\./);
    assert.match(md, /## Design/);
    assert.match(md, /Frontmatter plus a prose body\./);
  });

  it('a decision with NO description still gets a body, not just frontmatter', (t) => {
    // The starkest shape: notes and design and nothing else produced a file with frontmatter
    // and a COMPLETELY EMPTY body — the record type whose whole payload is prose, written
    // with none of it.
    const md = decisionBody(t, { notes: 'Only notes here.', design: 'And a design.' });

    const body = md.split(/^---$/m).slice(2).join('---').trim();
    assert.ok(body.length > 0, 'the decision was written with an empty body');
    assert.match(body, /Only notes here\./);
    assert.match(body, /And a design\./);
  });

  it('does not write the acceptance criteria twice', (t) => {
    // The same single token caused this: using the raw description meant the AC section was
    // emitted as frontmatter AND left inline in the prose.
    const md = decisionBody(t, {
      description: 'Body.',
      acceptance_criteria: '- one\n- two',
    });

    assert.equal((md.match(/Acceptance Criteria/gi) ?? []).length, 0,
      'the AC heading survived in the prose after being lifted into frontmatter');
    assert.match(md, /acceptance_criteria:/, 'AC should still reach the frontmatter');
  });
});

/**
 * Migrate a WHOLE list of records verbatim — no defaults merged.
 *
 * `migrateOne` cannot do this job: the defect below only exists between two records, and it
 * is sensitive to the order they appear in, so the caller has to own both.
 *
 * @param {TestContext} t
 * @param {Record<string, unknown>[]} records
 * @param {string[]} [args]
 * @returns {{ code: number|null, dir: string, out: string, stderr: string, stdout: string }}
 */
function migrateRecords (t, records, args = []) {
  const dir = tmpDir(t);
  const file = join(dir, 'export.jsonl');
  writeFileSync(file, records.map(r => JSON.stringify({ _type: 'issue', ...r })).join('\n') + '\n');
  const r = spawnSync('node', [SCRIPT, file, '--root', dir, ...args], { encoding: 'utf8' });
  return {
    code: r.status,
    dir,
    out: (r.stdout ?? '') + (r.stderr ?? ''),
    stderr: r.stderr ?? '',
    stdout: r.stdout ?? '',
  };
}

describe('a numeric bd id (the parse boundary)', () => {
  // `BdIssue` types `id` as a string and every bd export we have seen agrees — but JSON's
  // other scalar is a number, and bd's export is foreign and frozen. Untreated, a numeric id
  // put a NUMBER in `liveIds` while every lookup used a string, so the migrator reported
  // `blocker not live` about a blocker three lines up in the file it was writing, and offered
  // the blocked task as ready work in the migrated store.

  it('coerces a numeric `id` to a string', () => {
    const [r] = parseBdExport('{"_type":"issue","id":12345}\n');
    assert.equal(r?.id, '12345');
  });

  it('coerces a numeric `depends_on_id` to a string', () => {
    const [r] = parseBdExport('{"_type":"issue","id":"a","dependencies":[{"type":"blocks","depends_on_id":7}]}\n');
    assert.equal(r?.dependencies?.[0]?.depends_on_id, '7');
  });

  it('coerces `id: 0` rather than reading it as no id at all', () => {
    // The falsy-zero trap this file already warns about for `priority`: `!r.id` read a real
    // id as an absent one. `String(0)` is `'0'`, which is truthy and which `ID_RE` accepts.
    const [r] = parseBdExport('{"_type":"issue","id":0}\n');
    assert.equal(r?.id, '0');
  });

  it('does not launder a JSON `null` id into the string "null"', () => {
    // NUMBERS ONLY. A blanket `String()` turns `null` into the perfectly plausible id
    // `'null'` — a boundary inventing a value is worse than one passing a bad value to a
    // guard that refuses it.
    //
    // 🚨 THE TITLE IS DELIBERATELY NARROW, because a wider one was a lie. This case read
    // `leaves a non-numeric id alone rather than laundering it into a usable one`, and it
    // tested exactly one non-numeric value — the only one the product actually refuses.
    // `null` is FALSY, so `projectLive`'s `if (!r.id) throw` catches it; `true`, `{}` and
    // `[]` are truthy and reach the written store. So the case claimed a class, covered its
    // one safe member, and made the hole read as covered. See the refusal block below for
    // the members it does not speak for.
    //
    // Compared through `JSON.stringify` so the assertion says the value is still the JSON
    // null it arrived as — `assert.equal(r?.id, 'null')` would PASS on the laundered string,
    // which is the whole thing being refused here.
    const [r] = parseBdExport('{"_type":"issue","id":null}\n');
    assert.equal(JSON.stringify(r?.id), 'null');
  });

  for (const [label, json, check] of /** @type {[string, string, (v: unknown) => boolean][]} */ ([
    ['a boolean', '{"_type":"issue","id":true}', v => v === true],
    ['an object', '{"_type":"issue","id":{"a":1}}', v => typeof v === 'object' && v !== null && !Array.isArray(v)],
    ['an array', '{"_type":"issue","id":["x"]}', v => Array.isArray(v)],
  ])) {
    it(`passes ${label} id through UNCHANGED — refusing is the refusal's job, not the boundary's`, () => {
      // Deliberate, and it stays correct after the refusal exists. The boundary's contract is
      // "coerce numbers, launder nothing else"; turning `true` into `'true'` here would invent an
      // id, which is the whole thing this function refuses to do. `projectLive` is what says no —
      // see the refusal block below, which is where that job belongs.
      const [r] = parseBdExport(json + '\n');
      assert.ok(check(r?.id), `the boundary altered a non-numeric id (${label})`);
    });
  }

  it('does not ADD an `id` key to a record that had none', () => {
    // `censusFields` classifies by the keys a record carries, so it is the one consumer that
    // can tell absent from present-and-undefined. Normalising must not move that line.
    const [r] = parseBdExport('{"_type":"issue","title":"t"}\n');
    assert.ok(r && !('id' in r), 'the boundary invented an `id` key');
  });

  // The two orders below are the whole point. `dumpTasks` sorts with
  // `a.id.localeCompare(b.id)`, and `localeCompare` coerces its ARGUMENT but not its
  // RECEIVER — so before the fix, the numeric row LAST threw a TypeError (after `_archive`
  // was already written) while the same two rows the other way round wrote a corrupt store
  // and exited 0. One input, two failure modes, chosen by line order.

  /** @type {Record<string, unknown>} */
  const target = { id: 12345, title: 'The blocker', status: 'open', issue_type: 'task', priority: 2 };
  /** @type {Record<string, unknown>} */
  const blocked = {
    id: 'x-2',
    title: 'Blocked on it',
    status: 'open',
    issue_type: 'task',
    priority: 2,
    dependencies: [{ type: 'blocks', depends_on_id: '12345' }],
  };

  it('keeps the edge when the numeric-id row comes FIRST (this order used to exit 0 on a corrupt store)', (t) => {
    const { code, dir, out } = migrateRecords(t, [target, blocked]);

    assert.equal(code, 0, out);
    // The TALLY line, not the per-edge sentence. A `doesNotMatch` pinned to prose is the
    // dangerous direction of coupling: reword the message and the assertion passes forever
    // instead of failing loudly. `dropped N edge(s)` is the structural line and it is also
    // strictly stronger — it catches ANY dropped edge, not only one phrased as a liveness
    // claim about a blocker sitting three lines up in the file being written.
    assert.doesNotMatch(out, /dropped \d+ edge/, 'an edge was dropped that should have survived');
    assert.deepEqual(rowsIn(dir).find(r => r.id === 'x-2')?.deps, ['12345']);
  });

  it('keeps the edge when the numeric-id row comes LAST (this order used to throw at the sort)', (t) => {
    const { code, dir, out } = migrateRecords(t, [blocked, target]);

    assert.equal(code, 0, out);
    assert.doesNotMatch(out, /dropped \d+ edge/, 'an edge was dropped that should have survived');
    assert.deepEqual(rowsIn(dir).find(r => r.id === 'x-2')?.deps, ['12345']);
  });
});

/**
 * A bd record whose id is whatever you hand it — including shapes `BdIssue` forbids.
 *
 * The cast is the point: `BdIssue.id` is typed `string`, which is exactly the promise that was
 * never checked at runtime, so the cases below cannot be written without stepping around it.
 *
 * @param {unknown} id
 * @returns {BdIssue}
 */
const withId = (id) => /** @type {BdIssue} */ (
  /** @type {unknown} */ ({ id, title: 't', status: 'open', issue_type: 'task', priority: 2 })
);

/**
 * The same, as a `decision` — which routes to `decisions/<id>.md`, where the id becomes a
 * FILENAME rather than a field.
 *
 * @param {unknown} id
 * @returns {Record<string, unknown>}
 */
const decisionWithId = (id) => ({
  id, title: 'd', status: 'open', issue_type: 'decision', priority: 2,
});

describe('a bd id that is not a usable id is REFUSED, not written', () => {
  // The hole the numeric fix did not close, and the one it made look closed. Every downstream
  // check was a FALSITY test (`!r.id`), so `null`/`''` were refused while `true`, `{}` and `[]`
  // — all truthy — reached a written store. Measured before the guard:
  //
  //   id: {}    exit 0, `- id:\n      a: 1` written as a nested MAP
  //   id: true  exit 0, `validate` "Task validation passed" exit 0, `ready` served `backlog/true`
  //             (that wording is what validate said THEN; it reads "Store validation passed" since
  //             it started reading `decisions/` and `docs/` as well as `tasks/`)
  //
  // `id: true` is the one that matters: every gate in the product called that store fine.
  const liveIds = new Set(['p-1']);

  for (const [label, id] of /** @type {[string, unknown][]} */ ([
    ['a boolean', true],
    ['an object', { a: 1 }],
    ['an array', ['x']],
  ])) {
    it(`${label} id is refused rather than reaching a task row`, () => {
      assert.throws(() => projectLive(withId(id), liveIds, []), /unusable id/);
    });
  }

  it('a traversal id is refused — an id is interpolated into a decisions/ path', () => {
    // `decisions/${task.id}.md`. Before the guard this wrote to `<root>/pwned.md`, OUTSIDE the
    // store; deeper traversal escapes `--root` entirely. `ID_RE` admits no `/`, so reusing the
    // schema's own authority closes it without a bespoke path check.
    assert.throws(() => projectLive(withId('../../pwned'), liveIds, []), /unusable id/);
  });

  it('an EMPTY-string id keeps the older, better message — it IS no id', () => {
    // Two branches on purpose: "you gave me nothing" and "you gave me something I cannot use"
    // are different mistakes with different remedies, and collapsing them would regress the
    // message for the case that actually happens in the wild.
    assert.throws(() => projectLive(withId(''), liveIds, []), /no id/);
  });

  it('a non-string `depends_on_id` is a MALFORMED edge, not a liveness claim', () => {
    /** @type {string[]} */
    const dropped = [];
    const t = projectLive(
      /** @type {BdIssue} */ (/** @type {unknown} */ ({
        ...withId('p-1'), dependencies: [{ depends_on_id: { a: 1 }, type: 'blocks' }],
      })),
      liveIds,
      dropped
    );

    assert.equal(t.deps, undefined);
    assert.equal(dropped.length, 1);
    // THE ASSERTION THAT EARNS ITS PLACE. Left as a falsity check, an object target fell through
    // to the liveness branches and the report stated something FALSE about it — `(blocks;
    // satisfied: blocker not live)`, a liveness claim about a value that was never an id. Pinning
    // the drop alone would pass on the old behaviour too.
    assert.doesNotMatch(dropped[0] ?? '', /blocker not live/, 'reported a liveness fact about a non-id');
    assert.match(dropped[0] ?? '', /malformed edge/);
  });

  it('refuses identically whichever order the bad record appears in, and leaves NO trace', (t) => {
    // The numeric pair below tests the SUCCESS path. This pair tests that the failure path no
    // longer has two modes: the same value used to crash `dumpTasks` or write a corrupt store
    // depending only on line order — and the crash landed AFTER `copyFileSync` wrote `_archive`,
    // leaving a store that exists, is empty, and answers `ready` with a confident empty backlog
    // at exit 0. `projectLive` is called before the archive write, so refusing here is what makes
    // "a refusal leaves no trace" true rather than merely intended.
    const bad = { id: true, title: 'b', status: 'open', issue_type: 'task', priority: 2 };
    const good = { id: 'a-1', title: 'g', status: 'open', issue_type: 'task', priority: 2 };

    for (const order of [[bad, good], [good, bad]]) {
      const { code, dir } = migrateRecords(t, order);
      assert.equal(code, 1);
      assert.ok(!existsSync(join(dir, 'diarium')), 'refused, but a store was left behind');
    }
  });

  it('two decisions with unusable ids can no longer collapse into one file', (t) => {
    // Both used to write `decisions/[object Object].md` — the second overwriting the first while
    // the report listed the path twice and claimed two decisions were written. The count is the
    // non-prose assertion: it would have caught the overwrite directly.
    const { code, dir } = migrateRecords(t, [decisionWithId({ a: 1 }), decisionWithId({ b: 2 })]);

    assert.equal(code, 1);
    assert.ok(!existsSync(join(dir, 'diarium')), 'refused, but a store was left behind');
  });
});

describe('the channel policy (stderr may DUPLICATE, never ORIGINATE)', () => {
  // Row `diarie-wsp`, applied to this command. The sharpest inversion was `--lossy`: the
  // harmless "nothing is lost" report went to stdout while THE DATA-LOSS WARNING went to
  // stderr, and `--lossy` exits 0 — so a caller who redirected stderr saw a clean success and
  // never learned which fields it had just agreed to lose. The streams were ordered by the
  // exact inverse of importance, on the stream this package's founding paragraph calls the one
  // ten call sites pipe to /dev/null.
  //
  // NOTE what made this invisible: every helper here returned stdout and stderr CONCATENATED,
  // so no assertion in the suite could fail when a message moved between them. The helpers now
  // return the streams separately, and each case below asserts BOTH halves — the fact is on
  // stdout, AND stderr originated nothing. Asserting only the first would pass on a duplicate.

  it('--lossy names the dropped fields on stdout, with nothing originating on stderr', (t) => {
    const { code, stderr, stdout } = migrateOne(t, { some_future_field: 'x' }, ['--lossy']);
    assert.equal(code, 0);
    assert.match(stdout, /being dropped/);
    assert.match(stdout, /some_future_field/);
    assert.equal(stderr, '');
  });

  it('an --epic naming a non-live issue warns on stdout', (t) => {
    // The consequence is a task file written EMPTY, which the tally reports only as a bare
    // `0 → tasks-migration.yml`. The reason existed nowhere but stderr.
    const { code, stderr, stdout } = run(['--root', tmpDir(t), '--epic', 'nope=migration']);
    assert.equal(code, 0);
    assert.match(stdout, /--epic nope is not a live issue/);
    assert.equal(stderr, '');
  });

  it('the gitignored-archive note is on stdout', (t) => {
    const dir = tmpDir(t);
    spawnSync('git', ['-C', dir, 'init', '-q']);
    writeFileSync(join(dir, '.gitignore'), '*.jsonl\n');
    const { code, stderr, stdout } = run(['--root', dir]);
    assert.equal(code, 0);
    assert.match(stdout, /gitignored/);
    // THE LINE THAT MAKES THIS TEST ABOUT THIS BRANCH. All three archive branches contain the
    // token `gitignored` — the third says `is NOT gitignored` — so `/gitignored/` alone matches
    // whichever one fired. MEASURED: with `archiveIgnored` forced to false, destroying this
    // branch entirely, the assertion above stayed green while branch three printed instead.
    //
    // A negative on the DISCRIMINATOR rather than a positive on the prose, deliberately: the
    // sibling test below records that pinning a sentence broke it once when the wording
    // improved. `NOT` is the one word that cannot change without the branches changing meaning.
    assert.doesNotMatch(stdout, /NOT gitignored/, 'a different archive branch fired than the one under test');
    assert.equal(stderr, '');
  });

  it('the bd-history REGRESSION warning is on stdout (this branch had no test at all)', (t) => {
    // The one branch of the archive trio that reports a real regression: the project DID
    // version `.beads/`, and after this migration it would stop. `git add` alone is enough —
    // `git ls-files` reads the index, and `commit` would need a user identity CI may not have.
    const dir = tmpDir(t);
    spawnSync('git', ['-C', dir, 'init', '-q']);
    writeFileSync(join(dir, '.gitignore'), '_archive/\n');
    mkdirSync(join(dir, '.beads'), { recursive: true });
    writeFileSync(join(dir, '.beads', 'issues.db'), 'x');
    spawnSync('git', ['-C', dir, 'add', '.beads']);

    const { code, stderr, stdout } = run(['--root', dir]);
    assert.equal(code, 0);
    assert.match(stdout, /would stop being versioned/);
    assert.equal(stderr, '');
  });

  it('a plain successful migration writes NOTHING to stderr', (t) => {
    // Names no string, so it catches an UNCONDITIONAL future write that the four cases above
    // — each of which needs its own flag or git setup to reach its message — would miss.
    //
    // Its limits, stated because the whole point of this block is not overclaiming a channel:
    // it exercises the plain path only. A sixth message behind a flag is caught by nothing
    // here until someone adds the case. What covers the five CURRENT sites is that every `it`
    // asserts `stderr === ''` — not this one test.
    //
    // Measured by moving each message back to stderr in turn: four of the five turn exactly
    // one case red. The fifth (the archive-would-commit note) fires on ANY migration into a
    // non-git directory, so it reddens every case that does not set one up — which is why it
    // needs no dedicated `it` and why this one would catch it even if the others were deleted.
    const { code, stderr } = run(['--root', tmpDir(t)]);
    assert.equal(code, 0);
    assert.equal(stderr, '');
  });

  it('every `stderr.write` in bootstrap.js sits below the standalone-entry guard', () => {
    // The standing version of the five hand-mutations above, and the answer to the limit the
    // previous case admits: a sixth message behind a flag is caught by nothing until someone
    // writes its case. This one needs no case, because it reads the source rather than the
    // output. The repo has the precedent — `test/cli.spec.js` walks the tree to enforce the
    // `exit(2)` reservation rather than trusting a comment.
    //
    // Chosen over an ast-grep rule because the invariant is POSITIONAL, not syntactic:
    // `stderr.write` is correct and must stay legal below the `import.meta.url` guard, where
    // it is the direct-execution error handler mirroring `cli.js`. ast-grep matches shapes,
    // not "this node is lexically after that one".
    const src = readFileSync(fileURLToPath(new URL('../lib/migrate/bootstrap.js', import.meta.url)), 'utf8');

    // Comments stripped FIRST, and the anchor located in the stripped text so the offsets
    // agree. This file discusses stderr at length — that is what the fix was about — and a
    // prose mention must never read as a call. (Verified there is no `//` inside any string
    // or regex literal here, so line-stripping cannot eat code.)
    const code = src.split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');

    // TWO POSITIVE CONTROLS, and they are the difference between a guard and a decoration.
    // Without them this passes vacuously the moment either anchor moves: a reworded entry
    // guard, or a renamed/extracted runMigration, would leave the test happily asserting
    // something about a file that no longer contains what it names.
    assert.match(code, /export async function runMigration\b/, 'runMigration moved — re-anchor this test');
    const marker = code.indexOf('if (argv[1] && fileURLToPath(import.meta.url) === argv[1])');
    assert.notEqual(marker, -1, 'the standalone-entry guard was reworded — re-anchor this test');

    const offenders = [...code.matchAll(/\bstderr\s*\.\s*write\b/g)]
      .filter(m => m.index < marker)
      .map(m => code.slice(0, m.index).split('\n').length);

    assert.deepEqual(offenders, [],
      `stderr.write above the standalone-entry handler at line(s) ${offenders.join(', ')} — ` +
      'a fact that exists only on stderr is a fact ten callers pipe to /dev/null');
  });
});
