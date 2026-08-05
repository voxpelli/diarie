/**
 * bd-map.js — the bd vocabulary maps + a READ-ONLY shadow-dogfood projector (spike, not the shipped migrator).
 *
 * Projects a `bd export` JSONL snapshot into the flat-YAML task-schema shape,
 * applying the 9→4 type collapse this schema is built on: bd's nine issue types
 * become four exclusive kinds (`task` / `doc` / `decision` / `milestone`), with
 * bd's other five surviving as additive LABELS on a `task` (see TYPE_MAP below,
 * and the type model in `../schema.js`). This is deliberately the read-only HALF
 * of the full migration: it never writes into the task store, bd stays canonical,
 * and the projection is meant to be regenerated (never hand-edited) and thrown
 * away. Its purpose was to give that type-model decision its first implementation
 * feedback — dual-run the projected output against `bd ready` and compare — not to
 * ship a production migration path. `projectRecords` was exported for reuse by the
 * real migrator's eventual test suite; this spike itself ships untested by design,
 * its one-time job being done.
 *
 * The FULL lossless migrator (acceptance-criteria extraction from markdown,
 * comment history, --scrub handling, writing into the real substrate) shipped
 * separately, and IS `./bootstrap.js`. This script intentionally does LESS than
 * that and says so in its loss report.
 *
 * Usage — DIRECT EXECUTION ONLY. The CLI entry at the bottom sits behind an
 * `import.meta.url === argv[1]` guard, so the `migrate` subcommand does NOT reach it;
 * that runs the real migrator. Run this file itself, with two positionals:
 *
 *   bd export -o /tmp/bd-export.jsonl --readonly
 *   node <this-file> /tmp/bd-export.jsonl /tmp/tasks-shadow.yml
 *
 * (Its own usage message still names the CLI form. That message is stale, not a
 * second entry point — there is no route to this projector but direct execution.)
 *
 * Guardrail: refuses to write under any store's `tasks/` directory, in either form of
 * the name pair — the projection is scratch-only by construction, not an accident of
 * discipline.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  argv, exit, stderr, stdout,
} from 'node:process';

import yaml from 'js-yaml';
import {
  hasOwn,
  isObject,
  isStringArray,
  typesafeIsArray,
} from '@voxpelli/typed-utils';

import { isUsableId } from '../ids.js';
import { slugOf } from '../store/utils.js';
import {
  isAnyStoreDir, isNil,
} from '../schema.js';

/** @import { Priority, Status, TaskRow, TaskType } from '../schema.js' */

/**
 * One row of a `bd export` JSONL snapshot — the shape we are migrating AWAY from.
 *
 * Every field is optional and loosely typed on purpose. This describes a foreign
 * export from a tool whose writes are dead (beads 1.1.0) and whose archive is frozen;
 * we do not get to insist on its shape, only to survive it. The maps below turn each
 * field into something the schema recognises and report anything they cannot.
 *
 * @typedef BdIssue
 * @property {string} [id]
 * @property {string} [title]
 * @property {string} [status]        bd's vocabulary: open / in_progress / closed / deferred
 * @property {string} [issue_type]    bd's 9 types — collapsed to 4 by TYPE_MAP
 * @property {number|string} [priority]  bd's numeric 0–4
 * @property {string} [description]
 * @property {unknown} [labels]       trusted only after an Array.isArray check
 * @property {BdDependency[]} [dependencies]
 * @property {string} [updated_at]    ISO timestamp; we keep the date half
 * @property {unknown} [acceptance_criteria]  bd's STANDALONE AC field — see the note below
 * @property {unknown} [notes]        free prose; no schema field, folded into `description`
 * @property {unknown} [design]       free prose; same treatment as `notes`
 */

/**
 * `acceptance_criteria`, `notes` and `design` were ABSENT from this typedef until 2026-07-28,
 * and that absence WAS the bug. `projectLive` read acceptance criteria only by parsing an
 * `## Acceptance Criteria` heading out of `description`, so bd's standalone field went straight
 * through to nothing. Against one real export, 22 of 41 live tasks carried AC in the standalone
 * field and 0 in the body — including that project's release gate, which lost 435 characters of
 * criteria and 520 of notes. The import exited 0 and `diarie validate` passed afterwards.
 *
 * A typedef listing only the fields you already handle cannot tell you what you are missing; it
 * makes the omission invisible to `tsc` as well as to the reader. Hence the field census below:
 * the defence is no longer "remember to add the field", it is "any field this projector does not
 * account for is REPORTED, and refuses the migration by default".
 */

/**
 * @typedef BdDependency
 * @property {string} [type]              `blocks` → a dep; `parent-child` → a parent
 * @property {string} [depends_on_id]
 */

/**
 * bd exports more than issues (`_type` also covers dependencies, comments, …). This is the
 * predicate that says which rows are ours, and — being a type predicate — it is what makes
 * `BdIssue` bind to real data instead of decorating an `any`.
 *
 * @param {unknown} r
 * @returns {r is BdIssue}
 */
const isBdIssue = (r) => isObject(r) && r['_type'] === 'issue';

/**
 * Parse a `bd export` JSONL snapshot into issue records.
 *
 * THE PARSE BOUNDARY, and it has to be a real one. `JSON.parse` returns `any`, and `any`
 * is assignable to everything — so passing it straight to a `@param {BdIssue}` bound
 * `BdIssue` to NOTHING. tsc was not checking the migrator against bd's export; it was
 * checking it against a type that never touched a byte of real data, while every field
 * guard downstream looked redundant to the compiler.
 *
 * `unknown[]` plus one predicate fixes that: from here on, `BdIssue` is the actual type
 * of the actual rows, and each guard in projectLive/projectRecords is a checked narrowing
 * rather than decoration.
 *
 * The line-splitting half of this is now also `@voxpelli/ndjson`'s `ndjsonParseString`
 * (extracted 2026-07-11 from list-dependents-cli, which had the same code and a bug: it
 * dropped the final record when the input lacked a trailing newline). Swap to it once that
 * package is on npm — diarie cannot take an unpublished runtime dep without stranding the
 * plugin's `$PLUGIN_ROOT/diarie/cli.js` hook rung, which resolves deps from the plugin
 * cache. The `filter(Boolean)` below is what spares us that bug in the meantime; verified
 * against the real 131-record archive and against an unterminated input.
 *
 * What would NOT move into that package is the predicate — `_type === 'issue'` is bd's
 * vocabulary, not NDJSON's, and it is the part that earns the type.
 *
 * @param {string} contents  the raw JSONL
 * @returns {BdIssue[]}      issue rows only (bd also exports other `_type`s)
 */
export function parseBdExport (contents) {
  /** @type {unknown[]} */
  const parsed = contents.split('\n').filter(Boolean).map(l => JSON.parse(l));
  // `normalizeIds` BEFORE the predicate, not after: it runs while the rows are still
  // `unknown`, which is the only place it can, and it is what makes the paragraph above
  // ("from here on, `BdIssue` is the actual type of the actual rows") true rather than
  // approximately true. A row whose `id` is a number satisfies `BdIssue` as written and
  // is not one.
  return parsed.map(r => normalizeIds(r)).filter(r => isBdIssue(r));
}

/**
 * @param {unknown} v
 * @returns {unknown}
 */
const idAsString = (v) => typeof v === 'number' ? String(v) : v;

/**
 * Is this bd value an id the STORE can accept?
 *
 * `normalizeIds` above coerces numbers and deliberately launders nothing else — which is right,
 * but it is only half a policy. The other half is that something must REFUSE what it declines to
 * launder, and until now nothing did: every downstream check was a FALSITY test (`!r.id`), and
 * `true`, `{}` and `[]` are all truthy. They passed straight through into a written store.
 *
 * Measured, before this guard existed, one live task each:
 *
 *   id: {}    migrate exit 0  ->  `- id:\n      a: 1` (a nested MAP where an id belongs)
 *   id: []    migrate exit 0  ->  `id: []`
 *   id: true  migrate exit 0  ->  validate "Task validation passed" exit 0, and
 *                                 `ready` served `backlog/true` as real work
 *
 * `id: true` is the one that matters: EVERY GATE IN THE PRODUCT said that store was fine, and a
 * row entered the ready queue under a name nobody wrote. Two more consequences fall out of the
 * same hole — two decisions with different object ids both wrote `decisions/[object Object].md`,
 * the second silently overwriting the first while the report claimed both were written; and an
 * id of `../../pwned` escaped the store entirely, because the decision path is built by
 * interpolation (`decisions/${task.id}.md`).
 *
 * `ID_RE`, NOT a bespoke charset. It is the schema's single authority on id shape and `validate`
 * already applies it to every row — so a migrator that writes an id failing `ID_RE` is writing a
 * store its own gate rejects. Asking the same question at migrate time is not a new rule; it is
 * the existing rule asked EARLIER, where a refusal still leaves no trace. It closes the traversal
 * case for free, since `ID_RE` admits no `/`.
 *
 * Checked against real data rather than assumed: it refuses 0 of the 21 issue ids and 0 of the 4
 * dependency targets in `test/fixtures/bd-export.jsonl`, and 0 of the 70 rows in this repo's own
 * store. No working migration becomes a refusal.
 *
 * DELEGATES rather than restating the rule — the loader and `validate` ask the same question of
 * every row, and one id rule with three implementations is how they drift apart. It keeps its own
 * name because it is asked at a different moment (before the store exists, where a refusal still
 * leaves no trace) of a foreign shape this package does not get to insist on.
 *
 * 🚨 THE BARE PREDICATE, NEVER `isUsableRef`. That one admits a qualified `slug/id`, and bd has
 * no slug concept — so accepting `a/b` here would let it reach `decisions/${id}.md`, which is
 * built by interpolation, and write into a directory that does not exist. `ID_RE` admitting no
 * `/` is what the traversal argument above rests on, and only `isUsableId` preserves it.
 *
 * @param {unknown} v
 * @returns {v is string}
 */
export const isUsableBdId = isUsableId;

/**
 * bd's id-bearing fields, coerced to strings BEFORE `isBdIssue` mints a `BdIssue`.
 *
 * `BdIssue` types `id` and `depends_on_id` as strings, and every bd export we have seen
 * honours that — but JSON's other scalar is a number, and this is a foreign export from a
 * tool whose writes are dead. Its shape is not something we get to insist on.
 *
 * What a numeric id costs is silent and structural. `liveIds` collects `12345`, an edge
 * naming `"12345"` misses, and the loss report then ASSERTS SOMETHING FALSE about a row in
 * the file it is writing — `- T-2 → 12345 (blocks; satisfied: blocker not live)` about a
 * blocker three lines up — while T-2 is offered as ready work in the migrated store.
 *
 * Whether that is even NOTICED depends on record order, which is why it is not "a crash you
 * would have caught". `dumpTasks` sorts with `a.id.localeCompare(b.id)`, and `localeCompare`
 * coerces its ARGUMENT but not its RECEIVER, so only a numeric id in the `a` position
 * throws. Measured: `[{id:'a-1'},{id:12345}]` throws, the same two rows swapped return
 * silently, and a bucket holding ONE row never calls the comparator at all. The throw, when
 * it does come, comes AFTER `_archive` is written.
 *
 * Here, once, rather than at each of the dozen uses: an id that is a string everywhere makes
 * the mismatch unrepresentable, where scattered `String()` calls only make it unlikely. It
 * settles the falsy-zero question the same way `projectLive` settles it for `priority` —
 * `id: 0` is a real id, `String(0)` is `'0'`, and `!r.id` stops reading it as "no id". An
 * `id: ''` still refuses, deliberately: that one IS no id.
 *
 * NUMBERS ONLY, never a blanket `String()`. `String(null)` is `'null'` and `String({})` is
 * `'[object Object]'` — plausible-looking ids that never existed. A boundary that launders a
 * non-value into a usable one is worse than a boundary that hands it to the guard that says
 * so, and `projectLive` still throws on an id it cannot use.
 *
 * READ SIDE ONLY, and that is load-bearing: `_archive/bd-final-export.jsonl` is a
 * `copyFileSync` of the input path, so the archive keeps bd's bytes exactly as bd wrote
 * them. Nothing here rewrites the record of what was migrated FROM.
 *
 * @param {unknown} r  one parsed JSONL row, still foreign
 * @returns {unknown}  the same row, with numeric ids as strings
 */
function normalizeIds (r) {
  if (!isObject(r)) return r;

  const deps = r['dependencies'];
  /** @type {Record<string, unknown>} */
  const out = { ...r };

  // Assign only when the key is already there. Writing `id: undefined` into a row that had
  // no `id` ADDS the key, and `censusFields` classifies by the keys a record carries — it is
  // the one consumer here that can tell the difference between absent and present-undefined.
  if (out['id'] !== undefined) out['id'] = idAsString(out['id']);
  if (typesafeIsArray(deps)) {
    out['dependencies'] = deps.map(d => (isObject(d) && d['depends_on_id'] !== undefined
      ? { ...d, depends_on_id: idAsString(d['depends_on_id']) }
      : d));
  }

  return out;
}

/**
 * Every bd field this projector READS, mapped to WHO reads it and how that reading reports.
 *
 * `_type` is here because `isBdIssue` consumes it to select issue rows at all.
 *
 * A KEYED OBJECT, NOT A LIST OF NAMES, and the difference is the bug. As a bare list this was
 * an unexplained exemption: a field named here was skipped by the census no matter what the
 * consumer did with the value — so the fix for the 2026-07-28 incident (add
 * `acceptance_criteria`, `notes` and `design`, because the projector now reads them) is
 * precisely what blinded the census to them again when the read turned out to be conditional.
 * Three of them then shipped a comment promising "the residue census will report this" beside
 * a census that structurally could not.
 *
 * Writing the mechanism down is the anti-blinding device: every entry now has to answer "and
 * what happens when the value is a shape you cannot read?", which is the question a bare name
 * lets you skip. The ones that answer "nothing, silently" are gated by `censusFields`'
 * `placed` argument — see `PLACED_BY` in `./bootstrap.js`.
 *
 * EVERY LINE ADDED HERE STILL SHRINKS WHAT THE RESIDUE CHECK CAN SEE — that has not changed;
 * it is only no longer invisible. `test/migrate.spec.js` enumerates these keys with
 * `Object.keys`, so a new one costs a red test until someone states its class.
 *
 * Exported for the enumeration test and nothing else — `censusFields` remains the API. It was
 * deliberately private while it was a bare list, on the grounds that it only means anything
 * paired with `IGNORED_BD_FIELDS`; the test that fails on an unclassified key is worth more
 * than that privacy, and it cannot be written without the keys.
 */
export const CONSUMED_BD_FIELDS = /** @type {const} */ ({
  '_type': 'selects issue rows at all (isBdIssue); a non-issue row never becomes a task',
  'id': 'the row id, and every dep edge that names it — refuses (isUsableBdId) rather than dropping',
  'title': 'copied to the row verbatim',
  'status': 'STATUS_MAP; an unmapped value refuses',
  'issue_type': 'TYPE_MAP → type + label; an unmapped value refuses',
  'priority': 'PRIORITY_MAP; an unmapped value defaults to medium and says so (priorityDefaulted)',
  'labels': 'carried to the row; anything undroppable is reported (droppedLabels)',
  'dependencies': 'carried as deps/parent; a dropped edge is reported (droppedEdges)',
  'description': 'splitBody → the row body plus any `## Acceptance Criteria` section',
  'updated_at': 'the row `updated` date',
  // The three whose reading is CONDITIONAL. Each is placed only from a shape, and any other
  // shape yields nothing — which is why each is gated in PLACED_BY rather than trusted here.
  'acceptance_criteria': 'bdCriteria, from a string or a list — GATED (PLACED_BY)',
  'notes': 'bdProse → a `## Notes` section, from a string — GATED (PLACED_BY)',
  'design': 'bdProse → a `## Design` section, from a string — GATED (PLACED_BY)',
});

/**
 * Fields we KNOWINGLY do not carry, each with the reason it is safe to drop. The census's
 * second half — and the dangerous half.
 *
 * EVERY LINE ADDED HERE IS A DATA-LOSS DECISION, not a cleanup. This is the one place where an
 * edit silently shrinks what the residue check can see, exactly as an over-broad `.gitignore`
 * line silently shrinks lint scope in this repo (see the warning in `.gitignore` itself). A
 * field belongs here only if dropping it loses NOTHING a human authored: identity, provenance
 * git already holds, or a value derived from data we do carry. When in doubt, leave it OUT —
 * then it surfaces as residue and the migration refuses, which is the failure direction that
 * can still be corrected afterwards.
 *
 * Deliberately NOT here: `defer_until`. It is authored intent ("not before this date") with no
 * home in diarie's schema, so it must surface as residue rather than vanish behind a reason.
 */
export const IGNORED_BD_FIELDS = /** @type {const} */ ({
  // Identity. diarie's `agent` is an ACTIVE CLAIM (set when status is in_progress), not
  // ownership — mapping bd's owner onto it would fabricate a claim on every unclaimed task.
  'owner': 'record ownership; diarie has no owner concept (`agent` is an active claim, not ownership)',
  'assignee': 'as `owner` — diarie models assignment only as an in_progress claim',
  // Provenance git already holds, more reliably than a copied timestamp would.
  'created_at': 'creation provenance; the store is in git, which records this better',
  'created_by': 'creation provenance; git authorship records this better',
  // Transition timestamps for states that are not migrated: only CLOSED issues carry them,
  // and closed issues never become task rows.
  'started_at': 'lifecycle timestamp; diarie tracks only current status, not its transitions',
  'closed_at': 'lifecycle timestamp on closed issues, which are not migrated',
  'close_reason': 'set only on closed issues, which are not migrated',
  // Derived: recomputable from data we carry, and stale the moment the store is hand-edited.
  'dependency_count': 'derived from `dependencies`, which IS carried',
  'dependent_count': 'derived from the dependency graph, which IS carried',
  'comment_count': 'derived from bd comments, which this migrator does not carry',
});

/**
 * bd status → task-schema status. `deferred` has no exact analog — see loss
 * report. Exported so the real migrator (`./bootstrap.js`) shares this map
 * rather than re-deriving it — with ONE deliberate divergence: the real
 * migrator special-cases `deferred` to stay `deferred` (a first-class schema
 * status, pinned by migrate.spec.js), so the `deferred: 'cancelled'` entry
 * below serves the spike's approximation (projectRecords), not the real one.
 */
export const STATUS_MAP = /** @satisfies {Record<string, Status>} */ (/** @type {const} */ ({
  open: 'pending',
  in_progress: 'in_progress',
  closed: 'completed',
  // A deferred bd issue is excluded from `bd ready` (verified empirically) but
  // isn't a failure — 'cancelled' is the closest of the 5 YAML statuses (a
  // dependent should see it and pause, not silently block forever). This is
  // an approximation, not a clean mapping — flagged as a named loss below.
  deferred: 'cancelled',
}));

/**
 * bd numeric priority → task-schema priority string. Exported so the real
 * migrator (`./bootstrap.js`) reuses it rather than re-deriving it.
 */
export const PRIORITY_MAP = /** @satisfies {Record<`${number}`, Priority>} */ (/** @type {const} */ ({
  '0': 'critical',
  '1': 'high',
  '2': 'medium',
  '3': 'low',
  '4': 'backlog',
}));

/**
 * bd's 9 issue_types → the 4-type model this schema settled on.
 * `decision` and `milestone` pass through directly (bd already has them as
 * top-level types, not framings). The other 6 collapse to `task` + a label.
 *
 * TWO GUARDS, TWO DIFFERENT AXES. Do not collapse them, and do not "simplify" the
 * `hasOwn` away — an earlier version of this comment claimed the deleted runtime
 * `VALID_TYPES.has()` check "was dead code", and that was FALSE about the code it
 * described. Replayed against the pre-`hasOwn` lookup:
 *
 *   TYPE_MAP['constructor']  ->  Object.prototype.constructor  (TRUTHY)
 *   ...so `if (!mapped) continue` passed it straight through, and
 *   `VALID_TYPES.has(undefined) === false` was the SOLE catch.
 *
 * What actually closed that hole is `Object.hasOwn` at every lookup site — NOT the
 * satisfies-cast below. The two cover different things:
 *
 *   hasOwn      guards the KEY. Runtime, for every consumer, typed or not. It is what
 *               survives a hostile `issue_type` out of a foreign JSONL — which is the
 *               only input class this file's header says it must survive.
 *   the cast    guards a bad literal EDIT to this map. Compile-time, and only for
 *               someone who runs the gate. It also fails OPEN: misspell the TAG itself
 *               and it is silently ignored, where a typo'd TYPE is TS2552.
 *
 * NEITHER guards the VALUE at runtime, and that is why `projectLive` carries a THIRD
 * check. `hasOwn({...TYPE_MAP, bug: {type: 'bugg'}}, 'bug')` is `true`, and before that
 * check `'bugg'` reached the written row: measured, migrate wrote `type: bugg`, printed
 * its success report and EXITED 0, leaving a store `diarie validate` then called invalid.
 * `projectLive` now runs `isTaskType(mapped.type)` (and `isStatus` beside it) on the path
 * that WRITES a store. Do not delete those as redundant with the cast — the cast is
 * compile-time and fails open on a misspelled `@satisfies` tag.
 *
 * One tell worth knowing before deleting anything here: `TYPE_MAP` is a const-asserted
 * literal, so `TYPE_MAP[r.issue_type]` does not type-check at all. Whoever removes the
 * runtime guard must FIRST widen the type or add a cast — they have to delete the
 * compile-time guard in order to reach the runtime one.
 */
export const TYPE_MAP = /** @satisfies {Record<string, { type: TaskType, label: string | undefined }>} */ (/** @type {const} */ ({
  task: { type: 'task', label: undefined },
  decision: { type: 'decision', label: undefined },
  milestone: { type: 'milestone', label: undefined },
  bug: { type: 'task', label: 'bug' },
  feature: { type: 'task', label: 'feature' },
  chore: { type: 'task', label: 'chore' },
  story: { type: 'task', label: 'story' },
  spike: { type: 'task', label: 'spike' },
  epic: { type: 'task', label: 'epic' },
  // bd has no 'doc' type in its own vocabulary — nothing maps TO 'doc'. It
  // exists in the YAML model with zero bd-side source, which is itself a
  // fact worth recording (see loss report "typesWithNoBdSource").
}));

/**
 * File `field` under `into` as costing record `id` something.
 *
 * Shared by the two loss maps rather than written twice: `residue` and `unplaceable` differ in
 * what they MEAN, not in how they accumulate, and a second copy of three lines is where the two
 * would quietly stop agreeing about the id they record.
 *
 * @param {Map<string, string[]>} into
 * @param {string} field
 * @param {string} id
 * @returns {void}
 */
function note (into, field, id) {
  const ids = into.get(field) ?? [];
  ids.push(id);
  into.set(field, ids);
}

/**
 * Census a batch of bd records: which unconsumed fields actually carry content?
 *
 * THE POINT: this is driven by the keys PRESENT IN THE DATA, not by a list of fields someone
 * remembered to check. A bd release that adds a field, or a foreign tracker's export shaped
 * like bd's, surfaces here without anyone touching this file — which is the difference between
 * closing the bug and closing the class of bug.
 *
 * THREE OUTCOMES, NOT TWO. A field can be unknown (`residue`), knowingly dropped (`ignored`),
 * or — the one this could not see until 2026-08-06 — *named as consumed by a consumer that
 * declined this particular shape* (`unplaceable`). That third case is the dangerous one
 * precisely because it looks like the safe one from here: the key is in the consumed list, so
 * a census that classifies by key name calls it carried and says nothing.
 *
 * `placed` is how a caller states which of its claims are conditional. It is REQUIRED rather
 * than optional on purpose: an optional argument would let a caller re-acquire the old blind
 * behaviour by forgetting, which is the failure this parameter exists to end.
 *
 * @param {BdIssue[]} records
 * @param {Record<string, { places: (value: unknown) => boolean }>} placed
 *   consumed fields whose consumption is conditional, keyed by field name
 * @returns {{ residue: Map<string, string[]>, ignored: Map<string, number>, unplaceable: Map<string, string[]> }}
 *   `residue` maps an unaccounted-for field to the ids carrying it; `ignored` maps a
 *   knowingly-dropped field to how many records carried it; `unplaceable` maps a consumed
 *   field to the ids where its consumer could not read the shape it carried.
 */
export function censusFields (records, placed) {
  /** @type {Map<string, string[]>} */
  const residue = new Map();
  /** @type {Map<keyof typeof IGNORED_BD_FIELDS, number>} */
  const ignored = new Map();
  /** @type {Map<string, string[]>} */
  const unplaceable = new Map();

  for (const r of records) {
    // Once per record, and `<no id>` rather than a skip: a record with no usable id is exactly
    // the one whose losses a reader cannot otherwise locate in the export.
    const id = String(r.id ?? '<no id>');

    for (const [key, value] of Object.entries(r)) {
      // "Carries content" — an empty string, empty array or null is nothing to lose, and
      // reporting it would bury the fields that matter under noise.
      const present = typesafeIsArray(value)
        ? value.length > 0
        : value !== null && value !== undefined && String(value).trim() !== '';

      if (!present) continue;

      if (hasOwn(CONSUMED_BD_FIELDS, key)) {
        // Consumed by NAME is not consumed in FACT. A gated field is only carried when its
        // consumer can read this shape; when it cannot, the value is dropped just as surely as
        // an unknown field's would be, and the census is the only thing that can say so.
        //
        // `hasOwn`, not `placed[key]`: `key` comes from a foreign export, and a bare index on
        // `'constructor'` returns Object.prototype.constructor — a callable that would return
        // a truthy object and quietly certify the field as placed.
        const gate = hasOwn(placed, key) ? placed[key] : undefined;

        if (gate && !gate.places(value)) {
          note(unplaceable, key, id);
        }
        continue;
      } else if (hasOwn(IGNORED_BD_FIELDS, key)) {
        ignored.set(key, (ignored.get(key) ?? 0) + 1);
      } else {
        note(residue, key, id);
      }
    }
  }

  return { ignored, residue, unplaceable };
}

/**
 * Project a parsed bd export into the flat-YAML task rows, with a loss report.
 *
 * SPIKE LEFTOVER, used by the test suite (migrate.spec.js pins the priority mapping
 * here — the falsy-0 fix) but NOT by the shipped tool: the real migrator is
 * `./bootstrap.js`, which has its own `projectLive`. The file header's claim that
 * this is exported for the real migrator's eventual test suite never materialised;
 * deleting the export remains a decision for whoever retires the spike.
 *
 * @param {BdIssue[]} records   parsed bd export lines (regular issues only)
 * @returns {{ tasks: TaskRow[], loss: object }}
 */
export function projectRecords (records) {
  /** @type {TaskRow[]} */
  const tasks = [];
  /** @type {Set<string | undefined>} */
  const unknownStatuses = new Set();
  /** @type {Set<string | undefined>} */
  const unknownTypes = new Set();
  /** @type {Set<string | undefined>} */
  const untranslatedDepTypes = new Set();
  /** @type {string[]} */
  const deferredIds = [];
  /** @type {Array<{ id: string, priority: string | number | undefined }>} */
  const priorityDefaultedIds = [];
  let acceptanceCriteriaSkipped = 0;
  let idlessRecords = 0;
  let malformedEdges = 0;
  /** @type {string[]} */
  const droppedLabels = [];

  for (const r of records) {
    // An id-less bd row cannot become a task: the schema requires `id`, and every
    // blank one would collide with every other at load. Refuse it, and SAY SO — a
    // migrator that quietly drops rows is the worst kind of migrator.
    // `isUsableBdId`, not `!r.id`: a truthy-but-unusable id (`true`, `{}`, `[]`) is not an id
    // this projector can honour either, and counting it as id-less is the honest answer — the
    // spike's whole product is a loss report, so a row it cannot place must appear in it.
    if (!isUsableBdId(r.id)) { idlessRecords++; continue; }

    const status = hasOwn(STATUS_MAP, r.status) ? STATUS_MAP[r.status] : undefined;

    if (!status) { unknownStatuses.add(r.status); continue; }
    if (r.status === 'deferred') deferredIds.push(r.id);

    const mapped = hasOwn(TYPE_MAP, r.issue_type) ? TYPE_MAP[r.issue_type] : undefined;

    if (!mapped) { unknownTypes.add(r.issue_type); continue; }

    // isStringArray, not Array.isArray: the latter narrows `unknown` to `any[]`, so a bd
    // export with `labels: [{...}]` would flow straight into `TaskRow.labels: string[]`
    // unchecked. (It fails later, at validate — but a migration that fails at the gate is
    // a migration you have to run twice.)
    // A malformed `labels` is REPORTED, not swallowed. `isStringArray` rejects the whole
    // array if ONE element is a non-string (a bd export with `labels: [{name: 'x'}]`, or a
    // bare scalar), so the good labels go too — and if one of them was `epic`, the migrated
    // repo gets a container that is workable again: an epic, having no dependencies of its
    // own, offered as the next thing to work on instead of the children it contains. That
    // was a real bug here, and losing the label re-creates it in someone else's repo, by the
    // migration itself. The guard turned a type leak into a SILENT one, inside the function
    // whose entire product is a loss report.
    const rawLabels = r.labels;
    if (!isNil(rawLabels) && !isStringArray(rawLabels)) {
      droppedLabels.push(`${r.id}: ${JSON.stringify(rawLabels)}`);
    }
    const labels = [...(isStringArray(r.labels) ? r.labels : []), ...(mapped.label ? [mapped.label] : [])];

    /** @type {string[]} */
    const deps = [];
    /** @type {string | undefined} */
    let parent;
    for (const d of r.dependencies ?? []) {
      // A bare `continue` would drop an edge with NO record — inside the one function
      // whose entire product IS a loss report. Count it, or the report lies by omission.
      if (d.depends_on_id === undefined) { malformedEdges++; continue; }
      if (d.type === 'blocks') deps.push(d.depends_on_id);
      else if (d.type === 'parent-child') parent = d.depends_on_id;
      else untranslatedDepTypes.add(d.type);
    }

    // The full migrator (bj7) extracts `## Acceptance Criteria` from
    // markdown description bodies. This spike doesn't — that's real parsing
    // work belonging to the lossless migrator, not this ready-semantics
    // dogfood. Record the skip; don't silently drop it.
    if (/## Acceptance Criteria/i.test(r.description ?? '')) acceptanceCriteriaSkipped++;

    // `String()`, not a truthiness check: bd priority is numeric 0–4, and `0` is falsy —
    // `r.priority ? …` would silently coerce priority 0 (critical) to the medium default.
    const rawPriority = String(r.priority);
    let priority = hasOwn(PRIORITY_MAP, rawPriority) ? PRIORITY_MAP[rawPriority] : undefined;
    if (!priority) {
      priorityDefaultedIds.push({ id: r.id, priority: r.priority });
      priority = 'medium';
    }

    /** @type {TaskRow} */
    const task = {
      id: r.id,
      // Spread-conditional, not `title: r.title`. The reason is tsc, not the validator:
      // `exactOptionalPropertyTypes` forbids assigning `undefined` to an optional property.
      // Runtime behaviour is identical either way — `isNil` rejects a missing title and an
      // explicit `undefined` alike, and js-yaml drops undefined keys on dump. (An earlier
      // version of this comment claimed a present-but-undefined key would "slip through the
      // gate". It would not. Do not restore that claim: it invents a hole in the validator
      // and would tell whoever simplifies this line that they broke a guard that never was.)
      ...(r.title === undefined ? {} : { title: r.title }),
      status,
      type: mapped.type,
      priority,
    };
    if (labels.length) task.labels = labels;
    if (parent) task.parent = parent;
    if (deps.length) task.deps = deps;
    if (r.updated_at) task.updated = r.updated_at.slice(0, 10);

    tasks.push(task);
  }

  return {
    tasks,
    loss: {
      unknownStatuses: [...unknownStatuses],
      unknownTypes: [...unknownTypes],
      untranslatedDepTypes: [...untranslatedDepTypes],
      deferredIdsApproximatedAsCancelled: deferredIds,
      priorityDefaultedIds,
      acceptanceCriteriaSkipped,
      idlessRecords,
      malformedEdges,
      droppedLabels,
      note: 'idlessRecords counts bd rows with no `id`, which cannot become tasks (the schema ' +
        'requires one, and blank ids would collide at load) — they are dropped, and counted here ' +
        'so the drop is visible rather than silent. ' +
        'acceptanceCriteriaSkipped counts records with a "## Acceptance Criteria" markdown ' +
        'section that this read-only spike does not extract (that parsing belongs to the full ' +
        'lossless migrator, which does it) — not a defect in this projector. ' +
        'priorityDefaultedIds lists records whose bd priority was missing or out of the 0-4 ' +
        'range and was coerced to \'medium\'; because priority is the ready queue\'s sort key, a ' +
        'nonempty list means the projected ready ordering may diverge from `bd ready`.',
    },
  };
}

// --- CLI -------------------------------------------------------------------

if (argv[1] && fileURLToPath(import.meta.url) === argv[1]) {
  const [inputPath, outputPath] = argv.slice(2);
  if (!inputPath || !outputPath) {
    // The path to THIS file, not to the CLI. `diarie migrate` routes to the full migrator; this
    // projector is reachable only by executing it directly, and printing the CLI's usage here sent
    // anyone who hit it to a command that does something else.
    stderr.write('usage: node lib/migrate/bd-map.js <bd-export.jsonl> <output.yml>\n');
    exit(1);
  }
  // Segment-wise rather than a regex: the tracker dirs are TRACKER_DIRS-derived, and
  // splitting on `sep` needs no escaping of a leading dot. `some` (not indexOf)
  // so a repeated segment — /a/diarium/b/diarium/tasks — still trips the guard.
  //
  // BOTH forms of the pair, and it matters more here than anywhere: this is a safety net, so
  // a name it does not know about does not make it error — it makes it silently stop
  // guarding, and hand-write over a live store it was built to protect.
  const segments = resolve(outputPath).split(sep);
  // `isAnyStoreDir`, NOT `isTrackerDir` — retired names included. This guard used the
  // current-names-only check and therefore exited 0 while overwriting a live `.diarie/` store:
  // a project that has not migrated yet is precisely the one whose store still has the old
  // name, so the retired name is the case a guard most needs to know, not least. A safety net
  // that does not recognise a name does not error, it stops guarding.
  const hit = segments.findIndex((s, i) => isAnyStoreDir(s) && segments[i + 1] === 'tasks');
  if (hit !== -1) {
    // Name the segment ACTUALLY matched, not the current pair. Reporting `diarium/ (dotted or
    // not)` when what stopped you was a legacy `.diarie/` sends the reader looking for a store
    // that is not there, and hides the very fact worth knowing: the target has not migrated yet.
    stderr.write(`refusing to write under ${segments[hit]}/tasks/ — this projector is scratch-only ` +
      '(regenerate, never hand-edit; the live store is owned by `diarie migrate` / Edit)\n');
    exit(1);
  }

  const records = parseBdExport(readFileSync(inputPath, 'utf8'));
  const { loss, tasks } = projectRecords(records);

  // DERIVED from the output filename, never fixed. The store's convention is
  // `tasks-<slug>.yml`, and the slug is what namespaces every id in the file (`<slug>/<id>`)
  // — so a hardcoded one stamps whatever name this package happened to be developed under
  // onto every projection anybody ever generates, and their ids come back namespaced to a
  // project they have never heard of. It shipped that way once. Naming the output file names
  // the slug; a filename that is not `tasks-<slug>.yml` falls back to a neutral one.
  const slug = slugOf(basename(outputPath)) || 'shadow';
  writeFileSync(outputPath, yaml.dump({ meta: { slug, title: 'Shadow projection of bd (read-only spike)' }, tasks }));
  stdout.write(`projected ${tasks.length} issues → ${outputPath}\n`);
  stdout.write(`loss report: ${JSON.stringify(loss, undefined, 2)}\n`);
}
