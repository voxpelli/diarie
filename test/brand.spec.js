/**
 * brand.spec.js — the gate for the transcripts on diarie.dev.
 *
 * `brand/index.html` is the marketing page, and it quotes the CLI: three terminal
 * blocks and one YAML specimen, all presented to a reader as *what diarie actually
 * prints*. Nothing verified them. CLAUDE.md names the hole outright — "no gate can
 * catch a false claim in `brand/`" — and the hole had already been paid for: the page
 * once carried a PARAPHRASED `ENOSTORE` sentence that contradicted the one
 * `lib/store.js` emits, on the single error this whole tool exists to make
 * unmissable. A page that misquotes the founding defect's error message is worse than
 * a page that omits it.
 *
 * So this file closes it the only way that stays true: it does not compare the page
 * against a string a human typed here. It builds a throwaway store, spawns the real
 * `cli.js` against it, and asserts the page's block IS that output — character for
 * character, including the exit code.
 *
 * Why spawn rather than call `doTheWork`: the `{error, code}` shape and the exit code
 * are produced at the CLI boundary, not in `doTheWork` (see test/cli.spec.js's
 * header). The page quotes the boundary, so the test must run the boundary.
 *
 * Why EQUALITY and not "contains": a false claim is added to a block, not instead of
 * it. Containment would pass happily beside an invented eighth line of stats. If this
 * goes red because a real new line was added to a block, the fix is to make the
 * fixture produce that line — never to relax the comparison.
 *
 * The brand page is NOT in the package `files`, and neither is this test — both are
 * repo-only. `npm test` runs it; the published tarball has neither.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { env } from 'node:process';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';

import { TRACKER_DIRS } from 'diarie/schema';

/** @import { TestContext } from 'node:test' */

/**
 * The page shows the VISIBLE posture (`diarium/`, "on the shelf"), so the fixture has
 * to be in that posture too — the ids the page prints carry no store name, but the
 * ENOSTORE sentence does. Indexing the pair is what test/** is exempted from
 * `no-indexed-tracker-dir` for: pinning one named form is the point here, and
 * `defaultTrackerDir(false)` would only prove the constant equals itself.
 */
const STORE = TRACKER_DIRS[0];

/** The package root — `test/`'s parent. */
const PKG = fileURLToPath(new URL('..', import.meta.url));
/** The real CLI, invoked exactly as a reader of the page would invoke it. */
const CLI = join(PKG, 'cli.js');
/** diarie.dev. */
const PAGE = join(PKG, 'brand', 'index.html');

/**
 * The store behind the page's `ready` + `stats` transcript.
 *
 * Every number the page prints is a consequence of these seven rows: 2 ready (no
 * deps), 3 blocked (all waiting on the claim), 1 in-progress claim, 1 completed.
 *
 * 🚨 `updated` MUST STAY QUOTED. Unquoted, `2026-05-30` is a YAML *date*, js-yaml
 * hands back a Date object, and the loader — which accepts only strings — drops the
 * field. `stats` would then report `stale 0`, and the page's `stale 1` would become a
 * false claim this test blames on the page rather than on itself.
 *
 * The drop is no longer SILENT (`diarie-rdr`, fixed 2026-08-04): the loader warns
 * naming the consequence and tells you to add the quotes. So the quotes are no longer
 * a workaround for an invisible bug — they are just the correct way to write a date,
 * and getting it wrong now announces itself instead of skewing a number.
 */
const FIXTURE_YAML = `tasks:
  - id: proj-auth
    title: Add session auth
    status: pending
    type: task
    priority: high
  - id: proj-parser
    title: Harden YAML reader
    status: pending
    type: task
    priority: medium
  - id: proj-session
    title: Session store
    status: in_progress
    type: task
    priority: high
    updated: '2026-05-30'
  - id: proj-export
    title: Export command
    status: pending
    type: task
    priority: high
    deps: [proj-session]
  - id: proj-import
    title: Import command
    status: pending
    type: task
    priority: low
    deps: [proj-session]
  - id: proj-docs
    title: Write the docs
    status: pending
    type: task
    priority: low
    deps: [proj-session]
  - id: proj-init
    title: Init command
    status: completed
    type: task
    priority: medium
`;

/**
 * The path the ENOSTORE block passes to `--root`. It is quoted on the page, so it is
 * part of the sentence under test and cannot be swapped for a tmpdir.
 */
const NOWHERE = '/tmp/not-a-project';

/**
 * A temp dir that cleans itself up when the test ends.
 *
 * @param {TestContext} t
 * @returns {string}
 */
function tmpDir (t) {
  const dir = mkdtempSync(join(tmpdir(), 'diarie-brand-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/**
 * Build a throwaway store holding one `tasks-<slug>.yml`.
 *
 * @param {TestContext} t
 * @param {string} slug  the id namespace the page prints (`backlog/proj-auth`)
 * @param {string} body
 * @returns {string} the root to point the CLI at
 */
function seedStore (t, slug, body) {
  const dir = tmpDir(t);
  mkdirSync(join(dir, STORE, 'tasks'), { recursive: true });
  writeFileSync(join(dir, STORE, 'tasks', `tasks-${slug}.yml`), body);
  return dir;
}

/**
 * Run the real CLI.
 *
 * The store is passed through the `DIARIUM_ROOT` seam rather than `--root` so the
 * argv is literally what the page shows after the `$` — `ready`, `stats`. The
 * ENOSTORE case is the exception: there the page shows `--root`, so it is passed.
 *
 * @param {string[]} argv
 * @param {string} [root]  empty/omitted = do not set the seam
 * @returns {{ code: number, out: string, err: string }}
 */
function run (argv, root) {
  const r = spawnSync('node', [CLI, ...argv], {
    cwd: PKG,
    // Ambient root variables stripped: the page's transcripts are the CLI's output for THIS
    // fixture, and a developer's exported `DIARIUM_ROOT` — or a stale `TASKS_ROOT`, which is
    // a hard EUSAGE — would silently make them the output for something else.
    env: {
      ...env, DIARIUM_ROOT: undefined, TASKS_ROOT: undefined, ...root ? { DIARIUM_ROOT: root } : {},
    },
    encoding: 'utf8',
  });
  return { code: r.status ?? 1, out: r.stdout ?? '', err: r.stderr ?? '' };
}

/** The page, read once. A missing page is a failure, never a skip. */
const html = readFileSync(PAGE, 'utf8');

/**
 * Every `<pre>` block on the page, as the plain text a reader sees.
 *
 * The blocks are syntax-coloured with nested `<span>`s and the shell/JSON quoting is
 * entity-escaped, so both have to come off before anything can be compared. `&amp;`
 * is decoded LAST — decoding it first would turn a literal `&amp;lt;` into `<`.
 *
 * @returns {string[]}
 */
function preBlocks () {
  return [...html.matchAll(/<pre>([\s\S]*?)<\/pre>/g)].map(m => (m[1] ?? '')
    .replaceAll(/<[^>]+>/g, '')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&amp;', '&')
    .trim());
}

/**
 * The one block quoting a given command, or `undefined`.
 *
 * Located by content rather than by index: a designer reordering the sections must
 * not silently retarget an assertion at a different block.
 *
 * @param {string} needle
 * @returns {string | undefined}
 */
const blockQuoting = (needle) => preBlocks().find(b => b.includes(needle));

/**
 * Seed the transcript fixture and run both commands the page quotes against it.
 *
 * @param {TestContext} t
 * @returns {{ ready: ReturnType<typeof run>, stats: ReturnType<typeof run>, root: string }}
 */
function realOutput (t) {
  const root = seedStore(t, 'backlog', FIXTURE_YAML);
  return { ready: run(['ready'], root), stats: run(['stats'], root), root };
}

describe('diarie.dev quotes the REAL `ready` + `stats` output (brand/index.html)', () => {
  // The transcript is ONE block on the page, so it is asserted as one string. Its two
  // halves are separated by a blank line, exactly as a terminal leaves them.

  it('the fixture behind the transcript is a healthy store — both commands exit 0, silently', (t) => {
    // If either exited non-zero, or the loader complained on stderr, the fixture is
    // malformed and every comparison below would be measuring the wrong thing.
    const { ready, stats } = realOutput(t);
    assert.deepEqual(
      { readyCode: ready.code, readyErr: ready.err, statsCode: stats.code, statsErr: stats.err },
      { readyCode: 0, readyErr: '', statsCode: 0, statsErr: '' }
    );
  });

  it('the in-progress claim is GENUINELY stale — the page says `stale 1`', (t) => {
    // Pinned separately because the failure mode is silent and the diff it produces is
    // misleading. Drop the quotes around `updated:` in FIXTURE_YAML and js-yaml returns
    // a Date, the loader drops the non-string field, `stale` falls to 0, and the block
    // comparison below fails on a line about statistics — pointing at the page, when the
    // fault is here. This assertion names the real cause first.
    const { root } = realOutput(t);
    const { out } = run(['stats', '--stale'], root);
    assert.match(out, /backlog\/proj-session/);
  });

  it('the page carries a block quoting `$ diarie ready`', () => {
    assert.notEqual(blockQuoting('$ diarie ready\n'), undefined,
      'no <pre> on diarie.dev quotes `diarie ready` — if the block moved, retarget this test; if it went away, so did the claim');
  });

  it('...and that block is CHARACTER-FOR-CHARACTER what the CLI prints', (t) => {
    const { ready, stats } = realOutput(t);
    const expected = [
      `$ diarie ready\n${ready.out.trimEnd()}`,
      `$ diarie stats\n${stats.out.trimEnd()}`,
    ].join('\n\n');
    assert.equal(blockQuoting('$ diarie ready\n'), expected);
  });
});

describe('diarie.dev quotes the REAL ENOSTORE answer — the sentence this tool exists for', () => {
  // The page had a PARAPHRASE here once. ENOSTORE is the one error a caller must never
  // mistake for an empty backlog, so an approximate rendering of it on the front page is
  // the founding defect wearing a stylesheet.

  it(`${NOWHERE} does not exist — otherwise this whole suite tests nothing`, () => {
    assert.equal(existsSync(NOWHERE), false,
      `${NOWHERE} exists on this machine; the page's ENOSTORE example is not reproducible here`);
  });

  it('the missing store exits 1 (InputError), not 0 and not the reserved 2', () => {
    assert.equal(run(['ready', '--json', '--root', NOWHERE]).code, 1);
  });

  it('the answer is on STDOUT, never whispered to the stderr callers discard', () => {
    const { err, out } = run(['ready', '--json', '--root', NOWHERE]);
    assert.equal(JSON.parse(out).code, 'ENOSTORE');
    assert.doesNotMatch(err, /ENOSTORE/);
  });

  it('the page carries a block quoting the missing-store invocation', () => {
    assert.notEqual(blockQuoting(`$ diarie ready --json --root ${NOWHERE}`), undefined,
      'no <pre> on diarie.dev quotes the ENOSTORE example');
  });

  it('...and that block is the real JSON and the real exit code, verbatim', () => {
    const { code, out } = run(['ready', '--json', '--root', NOWHERE]);
    // `$ echo $?` is the shell's, not diarie's — but the number after it is diarie's, so
    // it is interpolated from the spawn rather than typed. A CLI that started exiting 2
    // here would fail this comparison instead of quietly agreeing with a stale page.
    const expected = `$ diarie ready --json --root ${NOWHERE}\n${out.trimEnd()}\n$ echo $?\n${code}`;
    assert.equal(blockQuoting(`$ diarie ready --json --root ${NOWHERE}`), expected);
  });
});

describe('the library snippet on diarie.dev actually RUNS', () => {
  // "A library with a bin" is a claim about the public `exports` map, and the snippet
  // spells out three things that can rot independently: that `computeReady` and
  // `loadTasks` are exported from the package root at all, that `loadTasks` resolves to
  // a bare array (not `{tasks, warnings}`), and that `computeReady` returns exactly the
  // three partitions it destructures. A reader copy-pastes this; so does the test.

  const SNIPPET_KEY = "import { computeReady, loadTasks } from 'diarie'";
  /** The one token the page cannot supply — everything else is executed as written. */
  const PLACEHOLDER = "'/path/to/project'";

  it('the page carries the import snippet', () => {
    assert.notEqual(blockQuoting(SNIPPET_KEY), undefined,
      'no <pre> on diarie.dev shows the library import');
  });

  it('...and running it verbatim against a real store yields the partitions it names', (t) => {
    const snippet = blockQuoting(SNIPPET_KEY) ?? '';
    assert.ok(snippet.includes(PLACEHOLDER), `the snippet no longer says ${PLACEHOLDER}; this test substitutes it for a real root`);

    const root = seedStore(t, 'backlog', FIXTURE_YAML);
    // The assertion runs INSIDE the snippet's own scope, on the very bindings it
    // destructures — an outer check could only re-derive them and prove nothing about
    // the names the page told the reader to use.
    const script = snippet.replace(PLACEHOLDER, JSON.stringify(root)) +
      '\nconst got = [ready.length, blocked.length, needsAttention.length].join()\n' +
      "\nif (got !== '2,3,0') throw new Error('the three partitions came back ' + got)\n";
    const r = spawnSync('node', ['--input-type=module', '-e', script], { cwd: PKG, encoding: 'utf8' });
    assert.equal(r.status, 0, `the page's own snippet failed:\n${r.stderr}`);
  });
});

describe('the YAML specimen on diarie.dev is a store `validate` accepts', () => {
  // The page shows a `tasks-backlog.yml` excerpt captioned as a specimen — an implicit
  // claim that this is the shape diarie reads. An excerpt cannot be run as-is (its
  // `deps:` names a row the page had no room to show), so the test supplies exactly that
  // one missing row and nothing else: whatever else is wrong with the specimen, this
  // still catches it.

  const SPECIMEN_KEY = 'tasks:\n  - id: proj-auth';
  const MISSING_DEP = '  - id: proj-session\n    title: the row the excerpt refers to\n    status: pending\n    type: task\n';

  it('the page carries a tasks-*.yml specimen block', () => {
    assert.notEqual(blockQuoting(SPECIMEN_KEY), undefined,
      'no <pre> on diarie.dev shows the task YAML specimen');
  });

  it('...and validate exits 0 on it (it parses, and every field is in the vocabulary)', (t) => {
    const specimen = blockQuoting(SPECIMEN_KEY) ?? '';
    const root = seedStore(t, 'backlog', `${specimen}\n${MISSING_DEP}`);
    const { code, out } = run(['validate'], root);
    assert.equal(code, 0, `validate rejected the page's own specimen:\n${out}`);
  });
});
