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

import { projectRecords } from '../lib/migrate/bd-map.js';
import {
  groupTasks, MIGRATE_OPTIONS, normalizeBody, projectLive, splitBody, USAGE,
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
 * @param {string[]} args
 * @param {string} [wd] working dir (to exercise the CWD default)
 * @returns {{ code: number|null, out: string }}
 */
const run = (args, wd) => {
  const r = spawnSync('node', [SCRIPT, EXPORT, ...args], { cwd: wd, encoding: 'utf8' });
  return { code: r.status, out: (r.stdout ?? '') + (r.stderr ?? '') };
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
 * @returns {{ code: number|null, out: string, stdout: string, dir: string }}
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
  return { code: r.status, out: (r.stdout ?? '') + (r.stderr ?? ''), stdout: r.stdout ?? '', dir };
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
