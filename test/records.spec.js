/**
 * The store beyond `tasks/` — enumeration, frontmatter, and the record linter.
 *
 * These cover the region `validate` could not see at all until now. The founding defect has
 * a directory-granularity form: a transposed `decisons/` costs every record inside it while
 * every command still exits 0, and no test over `tasks/` can catch it, because the mistake
 * is one level above the directory those tests look in.
 *
 * Pure units first (no IO), then the command end-to-end against throwaway stores.
 */

import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import {
  mkdirSync, mkdtempSync, rmSync, writeFileSync,
} from 'node:fs';

import { doTheWork as validateWork } from '../lib/commands/validate.js';
import { parseFrontmatter } from '../lib/store/frontmatter.js';
import { listStoreEntries } from '../lib/store/list-store-entries.js';
import { lintRecords } from '../lib/validate.js';

/** @type {string[]} */
const scratch = [];

after(() => {
  for (const dir of scratch) rmSync(dir, { force: true, recursive: true });
});

/**
 * A record's frontmatter as bytes, in the shape the WRITER emits it
 * (`bootstrap.js`'s `dumpDecision`): `---\n<yaml>\n---\n\n<body>\n`.
 *
 * @param {string} yaml
 * @returns {string}
 */
const doc = (yaml) => `---\n${yaml}\n---\n\nprose\n`;

/**
 * Build a valid record's parsed frontmatter, overridable per-field.
 *
 * @param {Record<string, unknown>} [fields]
 * @returns {Record<string, unknown>}
 */
const rec = (fields) => ({ id: 'd-1', title: 'x', status: 'pending', type: 'decision', ...fields });

/**
 * Lint a single record, as the command hands them over.
 *
 * @param {Record<string, unknown>} data
 * @param {{ base?: string, name?: string, type?: string }} [over]
 * @returns {string[]}
 */
const lintOne = (data, over = {}) => lintRecords([{
  base: over.base ?? 'd-1',
  data,
  name: over.name ?? 'decisions/d-1.md',
  type: over.type ?? 'decision',
}]).errors;

/**
 * Write a throwaway store and return its root.
 *
 * @param {(store: string) => void} build  receives the absolute store path
 * @returns {string}
 */
function storeWhere (build) {
  const root = mkdtempSync(join(tmpdir(), 'diarie-rec-'));
  scratch.push(root);
  const store = join(root, 'diarium');
  mkdirSync(join(store, 'tasks'), { recursive: true });
  writeFileSync(join(store, 'tasks', 'tasks-backlog.yml'), 'tasks: []\n', 'utf8');
  build(store);
  return root;
}

describe('parseFrontmatter — four failures, not one', () => {
  // The split is the point. Collapsing these into "invalid record" would report a shape
  // fault as a value fault: a file with no frontmatter would come back as five missing
  // required fields, sending the reader looking in five wrong places for one mistake.

  it('reads the shape the writer emits', () => {
    const parsed = parseFrontmatter(doc('id: d-1\ntitle: x'));
    assert.ok(parsed.ok);
    assert.deepEqual(parsed.data, { id: 'd-1', title: 'x' });
  });

  it('a file with no opening --- is not a record at all', () => {
    const parsed = parseFrontmatter('just prose\n');
    assert.ok(!parsed.ok);
    assert.match(parsed.reason, /no frontmatter/);
  });

  it('a missing closing --- is named as such, not reported as bad YAML', () => {
    // The whole document gets read as fields, so js-yaml may well parse it "fine" —
    // which is exactly why an unterminated file needs its own answer rather than
    // falling through to the value checks.
    const parsed = parseFrontmatter('---\nid: d-1\ntitle: x\n\nprose\n');
    assert.ok(!parsed.ok);
    assert.match(parsed.reason, /unterminated/);
  });

  it('YAML that throws is reported with js-yaml\'s own message kept intact', () => {
    // The parse snippet with its caret is the most actionable thing in the message —
    // paraphrasing it would cost the column the reader needs.
    const parsed = parseFrontmatter(doc('title: has a `status: pending` colon'));
    assert.ok(!parsed.ok);
    assert.match(parsed.reason, /invalid YAML in frontmatter/);
    assert.match(parsed.reason, /\^/);
  });

  it('frontmatter that parses to a SCALAR holds no fields, and says so', () => {
    const parsed = parseFrontmatter(doc('just a scalar'));
    assert.ok(!parsed.ok);
    assert.match(parsed.reason, /not a mapping/);
  });

  it('EMPTY frontmatter takes the same branch — `null` is no fields, not a special case', () => {
    const parsed = parseFrontmatter('---\n---\n');
    assert.ok(!parsed.ok);
    assert.match(parsed.reason, /not a mapping/);
  });
});

describe('lintRecords — the checks a record has and a row does not', () => {
  it('a well-formed record is clean', () => {
    assert.deepEqual(lintOne(rec()), []);
  });

  it('a record declaring a type its DIRECTORY is not the home of errors', () => {
    // Not a harmless mislabel: every reader globs `tasks-*.yml` for work, so this row
    // claims to be work that can never be offered, by anyone, ever.
    const errors = lintOne(rec({ type: 'task' }));
    assert.ok(errors.some(e => /declares type "task" but lives in the home of "decision"/.test(e)));
  });

  it('a record whose id disagrees with its filename errors', () => {
    // The writer's own invariant (`decisions/${id}.md`), unchecked until now. A pair that
    // disagrees means finding-by-filename and referring-by-id land on different files.
    const errors = lintOne(rec({ id: 'somewhere-else' }));
    assert.ok(errors.some(e => /does not match its filename/.test(e)));
  });

  it('the filename check quotes the id it rejected and names the fix', () => {
    // This branch's standing rule: a refusal names the token it rejected.
    const errors = lintOne(rec({ id: 'somewhere-else' }));
    assert.ok(errors.some(e => /"somewhere-else"/.test(e) && /expected d-1\.md/.test(e)));
  });

  it('one id used by two records in DIFFERENT directories errors', () => {
    // The only duplicate case that can exist: `<id>.md` makes an intra-directory
    // collision unrepresentable, because filenames are unique within a directory.
    const { errors } = lintRecords([
      { base: 'dupe', data: rec({ id: 'dupe' }), name: 'decisions/dupe.md', type: 'decision' },
      { base: 'dupe', data: rec({ id: 'dupe', type: 'doc' }), name: 'docs/dupe.md', type: 'doc' },
    ]);
    assert.ok(errors.some(e => /duplicate record id "dupe" — already used by decisions\/dupe\.md/.test(e)));
  });

  it('two records with different ids are not a duplicate', () => {
    const { errors } = lintRecords([
      { base: 'a', data: rec({ id: 'a' }), name: 'decisions/a.md', type: 'decision' },
      { base: 'b', data: rec({ id: 'b' }), name: 'decisions/b.md', type: 'decision' },
    ]);
    assert.deepEqual(errors, []);
  });
});

describe('lintRecords — the field rules it shares with a task row', () => {
  // These pass through `lintFields`, the ONE implementation. If a record ever disagreed
  // with a row about what a valid status is, the store would have two definitions of
  // valid — which is what `schema.js` exists to prevent.

  it('a missing required field errors, naming the field', () => {
    assert.ok(lintOne({ id: 'd-1', title: 'x', type: 'decision' })
      .some(e => /missing required field: status/.test(e)));
  });

  it('an invalid status enum errors on a record too', () => {
    assert.ok(lintOne(rec({ status: 'totally-bogus' })).some(e => /invalid status/.test(e)));
  });

  it('an invalid priority enum errors on a record too', () => {
    assert.ok(lintOne(rec({ priority: 'urgent' })).some(e => /invalid priority/.test(e)));
  });

  it('an unquoted `updated` date errors on a record too', () => {
    // The YAML-date trap, on the surface that had no gate at all until now.
    assert.ok(lintOne(rec({ updated: new Date('2026-05-30') })).some(e => /invalid updated/.test(e)));
  });

  it('a non-string title errors on a record too', () => {
    assert.ok(lintOne(rec({ title: 42 })).some(e => /invalid title/.test(e)));
  });

  it('the message calls it by its TYPE, not "task"', () => {
    // A reader told "task d-1: invalid status" about a file in `decisions/` would go
    // looking in `tasks-*.yml` for a row that is not there.
    const errors = lintOne(rec({ status: 'totally-bogus' }));
    assert.ok(errors.some(e => /decision d-1: invalid status/.test(e)));
    assert.ok(!errors.some(e => /task d-1/.test(e)));
  });
});

describe('listStoreEntries — the region nothing enumerated', () => {
  it('finds records in both homes and reports no strays for a tidy store', async () => {
    const root = storeWhere(store => {
      mkdirSync(join(store, 'decisions'), { recursive: true });
      mkdirSync(join(store, 'docs'), { recursive: true });
      writeFileSync(join(store, 'decisions', 'a.md'), doc('id: a'), 'utf8');
      writeFileSync(join(store, 'docs', 'b.md'), doc('id: b'), 'utf8');
    });

    const { records, unrecognized } = await listStoreEntries(root);

    assert.deepEqual(unrecognized, []);
    assert.deepEqual(records.map(r => r.name).toSorted(), ['decisions/a.md', 'docs/b.md']);
    assert.deepEqual(records.map(r => r.type).toSorted(), ['decision', 'doc']);
  });

  it('an ABSENT docs/ is ordinary — `init` never creates one', async () => {
    // Erroring on its absence would fail every store the tool itself writes.
    const root = storeWhere(store => {
      mkdirSync(join(store, 'decisions'), { recursive: true });
    });

    const { records, unrecognized } = await listStoreEntries(root);

    assert.deepEqual(records, []);
    assert.deepEqual(unrecognized, []);
  });

  it('a MISSPELLED record directory is reported as a directory', async () => {
    // The headline case. Sixteen records could sit in here, invisible to every command.
    const root = storeWhere(store => {
      mkdirSync(join(store, 'decisons'), { recursive: true });
      writeFileSync(join(store, 'decisons', 'a.md'), doc('id: a'), 'utf8');
    });

    const { records, unrecognized } = await listStoreEntries(root);

    assert.deepEqual(records, []);
    assert.deepEqual(unrecognized, [{ isDirectory: true, name: 'decisons' }]);
  });

  it('a non-markdown file inside a record home is reported, not silently skipped', async () => {
    const root = storeWhere(store => {
      mkdirSync(join(store, 'decisions'), { recursive: true });
      writeFileSync(join(store, 'decisions', 'notes.txt'), 'x\n', 'utf8');
    });

    const { unrecognized } = await listStoreEntries(root);

    assert.deepEqual(unrecognized, [{ isDirectory: false, name: 'decisions/notes.txt' }]);
  });

  it('dot-prefixed entries are the escape hatch, at BOTH levels', async () => {
    // Without this, a store owner has no way to keep a scratch file the tool ignores —
    // and a complaint with no remedy is what makes a gate get switched off.
    const root = storeWhere(store => {
      mkdirSync(join(store, 'decisions'), { recursive: true });
      mkdirSync(join(store, '.scratch'), { recursive: true });
      writeFileSync(join(store, '.notes.md'), 'x\n', 'utf8');
      writeFileSync(join(store, 'decisions', '.draft.md'), doc('id: draft'), 'utf8');
    });

    const { records, unrecognized } = await listStoreEntries(root);

    assert.deepEqual(unrecognized, []);
    assert.deepEqual(records, []);
  });

  it('tasks/ is left to its own reader — one naming rule, one implementation', async () => {
    // A second walker over `tasks/` would fork `TASKS_FILE_RE`, and a forked rule is how
    // this codebase has repeatedly ended up with two answers to one question.
    const root = storeWhere(store => {
      writeFileSync(join(store, 'tasks', 'tasks_typo.yml'), 'tasks: []\n', 'utf8');
    });

    const { records, unrecognized } = await listStoreEntries(root);

    assert.deepEqual(unrecognized, []);
    assert.deepEqual(records, []);
  });
});

describe('validate — the whole store, end to end', () => {
  it('counts every file it read, not just the task files', async () => {
    // Left as the task-file count this would report "1 file(s)" for a run that validated
    // three — a number that gets MORE wrong the more the command covers.
    const root = storeWhere(store => {
      mkdirSync(join(store, 'decisions'), { recursive: true });
      writeFileSync(join(store, 'decisions', 'a.md'), doc('id: a\ntitle: x\nstatus: pending\ntype: decision'), 'utf8');
      writeFileSync(join(store, 'decisions', 'b.md'), doc('id: b\ntitle: x\nstatus: pending\ntype: decision'), 'utf8');
    });

    const result = await validateWork({ root });

    assert.deepEqual(result.errors, []);
    assert.equal(result.fileCount, 3);
  });

  it('a record that does not parse is an ERROR, and the store is invalid', async () => {
    const root = storeWhere(store => {
      mkdirSync(join(store, 'decisions'), { recursive: true });
      writeFileSync(join(store, 'decisions', 'a.md'), doc('title: a `status: pending` colon'), 'utf8');
    });

    const result = await validateWork({ root });

    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0] ?? '', /decisions\/a\.md: invalid YAML in frontmatter/);
  });

  it('a stray entry is a WARNING in the payload, never a stderr-only aside', async () => {
    // `notices` is stderr-only by design and absent from `--json`. A finding put there is
    // invisible to every machine consumer — the whisper this package exists to stop.
    const root = storeWhere(store => {
      mkdirSync(join(store, 'decisons'), { recursive: true });
    });

    const result = await validateWork({ root });

    assert.deepEqual(result.errors, []);
    assert.equal(result.notices.length, 0);
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0] ?? '', /unrecognized directory/);
  });

  it('the stray-entry warning names the expected layout AND the opt-out', async () => {
    const root = storeWhere(store => {
      writeFileSync(join(store, 'stray.md'), 'x\n', 'utf8');
    });

    const result = await validateWork({ root });

    assert.match(result.warnings[0] ?? '', /expected tasks\/, decisions\/, docs\//);
    assert.match(result.warnings[0] ?? '', /prefix it with a dot/);
  });

  it('a store with only tasks/ is unchanged — this is additive', async () => {
    // The whole point of keeping records out of the dep graph: no existing answer moves.
    const root = storeWhere(() => {});

    const result = await validateWork({ root });

    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.warnings, []);
    assert.equal(result.fileCount, 1);
  });
});
