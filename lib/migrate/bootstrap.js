/**
 * bootstrap.js — the bd → flat-YAML migrator (`diarie migrate`).
 *
 * The write-half the read-only spike (`bd-map.js`) deliberately isn't.
 * Reads a `bd export` JSONL snapshot and evacuates the LIVE issues (everything
 * not `closed`) into the real substrate, under `--root`:
 *
 *   <root>/<store>/tasks/tasks-<slug>.yml     live tasks, grouped (see --epic)
 *   <root>/<store>/decisions/<id>.md          decision-type issues (prose has no YAML home)
 *   <root>/<store>/_archive/bd-final-export.jsonl   the full snapshot (ALL statuses) — the
 *                                            only git-tracked survivor of bd history,
 *                                            since `.beads/` is gitignored.
 *
 * `<store>` is `diarium/`, or `.diarium/` with `--dotted` — the posture the target repo
 * wants (decision `diarie-pos`). The overwrite guard checks EVERY store name, not just the
 * one this run would write; see the comment on it.
 *
 * ORIGINALLY a one-shot for a single project (it hardcoded that repo's migration
 * epic and its two slugs). It was generalized to run against ANY bd repo — beads
 * 1.1.0's write-break hit every repo on the global binary at once, so the sibling
 * repos needed the same evacuation. That reverses the original plan to retire it
 * after one run: a tool other repos depend on earns kept test coverage (see
 * `test/migrate.spec.js`), because its failure mode is SILENT
 * DATA LOSS, not a crash. It is still a bootstrap, not a CRUD tool — ongoing
 * writes stay plain hand-edits to the YAML (the substrate ships no CRUD helper, by
 * design).
 *
 * What it does beyond the spike, each learned the hard way:
 *
 *   - `deferred` is preserved as `deferred` (the schema has the status); the
 *     spike approximated it to `cancelled`.
 *   - `## Acceptance Criteria` bullets are extracted into `acceptance_criteria`;
 *     the rest of each body is preserved as `description` (lossless — `validate`
 *     accepts the field and the ready computation ignores it entirely; groom later
 *     if a terser model is preferred).
 *   - Some bd bodies store literal backslash-n instead of real newlines, which
 *     un-anchors the `## Acceptance Criteria` heading and SILENTLY drops the
 *     criteria. Normalized before parsing.
 *   - An edge whose target is not in the live set is DROPPED, not dangled — a
 *     closed blocker is already satisfied, and a closed parent is history. Both
 *     are reported; the original edges live on in the archive JSONL.
 *
 * Two guards, because this now runs against repos that are not this one:
 *
 *   - `--root` defaults to the CURRENT DIRECTORY, never this package's own checkout.
 *     A script-relative default would make a forgotten `--root` clobber the tracker
 *     of whatever tree the installed code sits in, with some other project's issues.
 *   - An existing `tasks-*.yml` store is a HARD STOP (`--force` to override).
 *     The migration is one-way: re-running replays the export over hand-edits.
 *
 * Usage (`<epic-id>` is an id from your own bd export — the epic whose descendants
 * you want routed into their own `tasks-<slug>.yml`):
 *
 *   bd export -o /tmp/bd-export.jsonl
 *   diarie migrate /tmp/bd-export.jsonl --root . \
 *     --epic <epic-id>=migration \
 *     --title migration='Tracker migration off bd' \
 *     --default-slug backlog \
 *     --title backlog='Standalone backlog (non-epic live work)'
 *
 * Dry-run: point `--root` at a scratch dir and diff before writing for real.
 */

import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync,
} from 'node:fs';
import {
  argv, cwd, env, exit, stderr, stdout,
} from 'node:process';

import yaml from 'js-yaml';
import {
  hasOwn, isStringArray, isType, typesafeIsArray,
} from '@voxpelli/typed-utils';

import { renderRejected } from '../format.js';
import { assertStorePathFree } from '../store/init.js';
import { legacyTrackerDirIn, ROOT_ENV_NAMES, trackerDirIn } from '../store/root.js';
import { InputError } from '../utils/errors.js';
import {
  defaultTrackerDir, ID_RE, isNil, isStatus, isTaskType,
} from '../schema.js';
import {
  censusFields, IGNORED_BD_FIELDS, isUsableBdId, parseBdExport, PRIORITY_MAP, STATUS_MAP, TYPE_MAP,
} from './bd-map.js';

/**
 * @import { BdIssue } from './bd-map.js'
 * @import { TaskRow } from '../schema.js'
 */

/** A slug becomes a `tasks-<slug>.yml` filename — keep it filesystem-plain. */
const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

/**
 * The task files inside a store directory — for NAMING what a refusal is protecting, never
 * for deciding whether to refuse. (That decision is the store directory's existence; see the
 * overwrite guard.)
 *
 * `.ya?ml`: both readers accept either extension, so matching only `.yml` would let a
 * `tasks-*.yaml` store be described as empty right before it was clobbered.
 *
 * @param {string} storePath  absolute path to a `diarium`/`.diarium`/legacy directory
 * @returns {string[]}
 */
function taskFilesIn (storePath) {
  const dir = resolve(storePath, 'tasks');
  return existsSync(dir) ? readdirSync(dir).filter(f => /^tasks-.+\.ya?ml$/.test(f)) : [];
}

/**
 * The flags `runMigration` accepts, in ONE place — the parser reads it AND the USAGE-parity
 * test asserts against it, so the two cannot drift (a hand-copied usage string already had).
 *
 * `json` governs ERROR shape only: on failure, `cli.js`'s boundary emits the InputError as JSON
 * on stdout. A SUCCESSFUL migrate always prints its human progress report — there is no
 * machine-readable success payload, because a bootstrap's output is a report, not a queryable result.
 *
 * An EXPLICIT literal type, NOT the wide `ParseArgsConfig['options']`: the wide type is an index
 * signature, which erases the per-key names (`values.root` would fail TS4111) and widens every value
 * to `string | boolean | ... | undefined`. Spelling the keys out — with literal `'string'` and
 * `multiple: true` — is what lets parseArgs infer `values.epic` as `string[]`, `values.root` as
 * `string`, etc., exactly as the old inline literal did. (`@satisfies` re-widens `multiple: true`
 * to `boolean` via its contextual type.)
 *
 * An earlier version of this comment also claimed a JSDoc const-assertion is "unsupported in
 * this tsc". That is FALSE as a general statement, and is corrected rather than deleted because
 * a comment overstating a tooling limit is how the next reader gets talked out of a better
 * option. A const-assertion on an ARRAY literal type-checks fine here (tsc 5.9.3) and yields a
 * real readonly tuple — disproved by probe, not by argument. Whether it also solves THIS
 * object-literal case was never tested; if you try it, test it, and record what you found.
 *
 * @type {{
 *   root: { type: 'string' },
 *   epic: { type: 'string', multiple: true, default: string[] },
 *   'default-slug': { type: 'string', default: string },
 *   title: { type: 'string', multiple: true, default: string[] },
 *   force: { type: 'boolean', default: boolean },
 *   dotted: { type: 'boolean', default: boolean },
 *   lossy: { type: 'boolean', default: boolean },
 *   json: { type: 'boolean' },
 * }}
 */
export const MIGRATE_OPTIONS = {
  root: { type: 'string' },
  epic: { type: 'string', multiple: true, 'default': [] },
  'default-slug': { type: 'string', 'default': 'backlog' },
  title: { type: 'string', multiple: true, 'default': [] },
  force: { type: 'boolean', 'default': false },
  // Mirrors `init --dotted`. Without it this command would hardcode a posture that decision
  // `diarie-pos` puts in the repo's hands — and a bootstrap is exactly when that choice is
  // made, since it is the moment the store first exists.
  dotted: { type: 'boolean', 'default': false },
  // Proceed even though some of the export cannot be carried into the store. A DIFFERENT
  // question from `--force`, which is about clobbering a store that already exists: this one is
  // about content, that one is about the destination. Collapsing them would let someone who
  // wanted to redo a botched migration silently accept data loss they never considered.
  lossy: { type: 'boolean', 'default': false },
  json: { type: 'boolean' },
};

/**
 * The one canonical usage string. Lives here, beside the parser it describes — NOT in
 * `commands/migrate.js`, which imports it: that module already imports `runMigration` from here,
 * so the reverse dependency would be a cycle. Every flag listed below is a key of MIGRATE_OPTIONS,
 * enforced by a test.
 */
export const USAGE = `Usage: diarie migrate <bd-export.jsonl> [options]

  --root <dir>            project root to write into (default: the current directory)
  --epic <id>=<slug>      route an epic + its descendants to tasks-<slug>.yml (repeatable)
  --default-slug <slug>   everything else (default: backlog)
  --title <slug>=<title>  meta.title for a slug (repeatable)
  --force                 overwrite an existing task store (destroys hand-edits)
  --dotted                create the dotted store form rather than the visible one
  --lossy                 proceed even though part of the export cannot be carried over
  --json                  emit errors as JSON on stdout (success output stays human-readable)

Get the input with:  bd export -o /tmp/bd-export.jsonl

This is a BOOTSTRAP, not a sync. It runs once; afterwards the store is hand-edited
like any other file. An existing store is a hard stop unless you pass --force.`;

/**
 * Undo bd's create-time escaping artifact: some issue bodies store a literal
 * backslash-n instead of a real newline.
 *
 * EVERY path that touches a bd body must go through this. It lived inside `splitBody`
 * once, which meant the TASK path was normalized and the DECISION path was not — and a
 * decision is *entirely* prose, so its whole payload rendered as one line of `\n`
 * gibberish. The repo this migrator was written in never saw it: its handful of decisions
 * happened not to carry the escaping artifact, and its one artifact-carrying issue was a
 * task. Only a FOREIGN export would have hit it — which is every export this tool now
 * runs against.
 *
 * @param {string} [body]
 * @returns {string}
 */
export function normalizeBody (body) {
  return (body ?? '').replaceAll('\\n', '\n');
}

/**
 * Split a bd markdown body into extracted acceptance criteria and the remaining
 * description. The AC section runs from a `## Acceptance Criteria` heading to the
 * next `##` heading (or EOF); its bullet lines become the list, and the body with
 * that whole section excised becomes the description.
 *
 * @param {string} body
 * @returns {{ description: string, acceptanceCriteria: string[] }}
 */
export function splitBody (body) {
  // Normalize first, or the `## Acceptance Criteria` heading is never line-anchored and
  // the criteria SILENTLY vanish — a real bug, and a quiet one: the body still migrates,
  // the task still lands, and only its acceptance criteria are gone.
  const lines = normalizeBody(body).split('\n');
  const acIdx = lines.findIndex(l => /^##\s+Acceptance Criteria\s*$/i.test(l));
  if (acIdx === -1) return { description: lines.join('\n').trim(), acceptanceCriteria: [] };

  let end = lines.length;
  for (let i = acIdx + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i] ?? '')) { end = i; break; }
  }
  const acceptanceCriteria = lines
    .slice(acIdx + 1, end)
    .filter(l => /^\s*(?:[-*]|\d+\.)\s+/.test(l))
    // strip the bullet, then an optional `[ ]`/`[x]` task-list checkbox marker
    .map(l => l.replace(/^\s*(?:[-*]|\d+\.)\s+/, '').replace(/^\[[ x]\]\s*/i, '').trim())
    .filter(Boolean);

  const description = [...lines.slice(0, acIdx), ...lines.slice(end)].join('\n').trim();
  return { description, acceptanceCriteria };
}

/**
 * The shapes `bdCriteria` can actually place, as a predicate rather than a claim.
 *
 * THIS IS THE CENSUS'S EYES, and it is deliberately the same function the consumer branches on
 * — not a second description of it. A field listed in `CONSUMED_BD_FIELDS` is exempt from the
 * residue check by NAME, so for a field whose consumer silently declines some shapes, that
 * exemption is only honest if something checks the shape. Two implementations of "what does
 * bdCriteria accept" would drift, and the drift would be invisible in exactly the direction
 * that costs data: the census would keep reporting "placed" for a value the projector dropped.
 * One definition, used by both, makes that unrepresentable.
 *
 * @param {unknown} raw
 * @returns {raw is string | unknown[]}
 */
function placesCriteria (raw) {
  return isType(raw, 'string') || typesafeIsArray(raw);
}

/**
 * As `placesCriteria`, for the free-prose fields: `bdProse` renders a string and nothing else.
 *
 * A LIST IS NOT A STRING HERE, and that asymmetry with `acceptance_criteria` is the whole
 * point of having two predicates. `design: ['authored design']` is an entirely plausible bd
 * shape that this projector cannot render — and until the census could see the difference, it
 * was dropped at exit 0 with no report.
 *
 * @param {unknown} raw
 * @returns {raw is string}
 */
function placesProse (raw) {
  return isType(raw, 'string');
}

/**
 * Coerce bd's standalone `acceptance_criteria` into a string list.
 *
 * Typed `unknown` on BdIssue and guarded here rather than trusted: this is a FOREIGN export
 * whose writes are dead, so its shape is something to survive rather than to insist on. bd has
 * written this field as a list of strings and as a single newline-separated string; both are
 * accepted, anything else yields nothing — and the census reports it, because `placesCriteria`
 * is the same predicate the guard below branches on.
 *
 * @param {unknown} raw
 * @returns {string[]}
 */
function bdCriteria (raw) {
  // BOTH branches go through `normalizeBody` and both split on newlines. Its own doc says
  // every path touching a bd body must — and the list form is a bd body just as much as the
  // string form is, so a `\n` escaping artifact inside a list ITEM would otherwise survive
  // into the store while the identical line from the markdown body was normalized, and the
  // union below would then de-duplicate nothing.
  if (!placesCriteria(raw)) return [];

  const lines = typesafeIsArray(raw)
    ? raw.flatMap(v => normalizeBody(String(v)).split('\n'))
    : normalizeBody(raw).split('\n');

  return lines
    // Strip a leading bullet and an optional `[ ]`/`[x]` checkbox, exactly as splitBody does —
    // the two sources must normalize identically or the union de-duplicates nothing.
    .map(l => l.replace(/^\s*(?:[-*]|\d+\.)\s+/, '').replace(/^\[[ x]\]\s*/i, '').trim())
    .filter(Boolean);
}

/**
 * One of bd's free-prose side fields as a `## <heading>` section, or nothing.
 *
 * `unknown` in, and that is the point: bd's export is foreign, so a field typed `string` in
 * the typedef is a hope, not a guarantee. Anything that is not a string yields no section —
 * and the census reports it, because `placesProse` is the same predicate this guard uses.
 *
 * @param {string} heading
 * @param {unknown} raw
 * @returns {string[]}
 */
function bdProse (heading, raw) {
  if (!placesProse(raw)) return [];
  const text = normalizeBody(raw).trim();
  return text ? [`## ${heading}\n\n${text}`] : [];
}

/**
 * The consumed fields whose consumption is CONDITIONAL, and the condition.
 *
 * `censusFields` exempts a field from the residue check because this projector claims to read
 * it. For most fields that claim is unconditional — `id`, `status`, `title` are read whatever
 * they hold. For these three it is not: each is placed only from a shape, and any other shape
 * yields nothing at all. Listing them here is what lets the census tell "consumed" apart from
 * "named in the consumed list", which are the two things the 2026-07-28 incident conflated.
 *
 * `accepts` is prose for the refusal, not a type: the reader of an ELOSSY needs to know what
 * to change the value TO, and "expected a string" is the whole remedy for this class. It sits
 * beside the predicate so the two cannot describe different shapes.
 *
 * A field belongs here whenever its consumer has a `return []` for some input. Adding one is
 * cheap; forgetting one is how a field goes quiet again.
 *
 * @satisfies {Record<string, { accepts: string, places: (value: unknown) => boolean }>}
 */
export const PLACED_BY = {
  acceptance_criteria: { accepts: 'a string, or a list', places: placesCriteria },
  notes: { accepts: 'a string', places: placesProse },
  design: { accepts: 'a string', places: placesProse },
};

/**
 * Project one live bd issue into a flat-YAML task record.
 *
 * Edges to non-live (closed) issues are dropped rather than carried: a closed
 * blocker is already satisfied, and a closed parent is history. Carrying either
 * would dangle and fail `diarie validate`.
 *
 * @param {BdIssue} r a parsed bd issue
 * @param {Set<string>} liveIds ids of every issue being migrated
 * @param {string[]} droppedEdges accumulator for dropped (non-live) edges
 * @param {string[]} [priorityDefaulted] accumulator for coerced priorities
 * @param {string[]} [droppedLabels] accumulator for malformed `labels` values
 * @returns {TaskRow} the task row (bare ids — the loader namespaces them)
 */
export function projectLive (r, liveIds, droppedEdges, priorityDefaulted = [], droppedLabels = []) {
  // Throw, never fall through: an absent value yields `undefined`, js-yaml then DROPS
  // the key on write, and the result is a task row silently missing a required field —
  // the exact failure mode this migrator exists to avoid. A migrator that loses data
  // quietly is worse than one that stops.
  //
  // Typing `r` as BdIssue instead of `any` is what surfaced the rest of these: `id`,
  // `issue_type` and `depends_on_id` were all dereferenced as if guaranteed. bd's own
  // exports happen to carry them, so only a foreign export would ever have been bitten.
  //
  // AN InputError, NOT A BARE Error, and that is not decoration. Everything reaching cli.js must
  // be an InputError or a ResultError; anything else lands in the "genuinely unexpected" branch
  // and is answered with a stack trace on stderr and NOTHING on stdout — which a `--json` caller
  // reads as "no data". A foreign export carrying a status this migrator has never seen is the
  // most ordinary thing that can happen to this command, and it was being reported as a crash:
  // measured, `migrate --json` on an unmapped status gave exit 1 with stdout at ZERO BYTES,
  // indistinguishable from ENOSTORE to anything parsing the machine channel.
  //
  // EUSAGE rather than a new code, deliberately: a new code costs seven surfaces (see the
  // measured list in lib/schema.js) and this is what EUSAGE already means — the input is wrong
  // and the caller is the one who can fix it.
  if (isNil(r.id) || r.id === '') {
    throw new InputError(
      'bd record with no id — cannot become a task (the schema requires one)',
      'Every row needs an id: it is written into the row, into any `decisions/<id>.md` filename,\n' +
      'and into every edge that names it. Give the record an id in bd, then re-run.',
      'EUSAGE'
    );
  }

  // A SEPARATE branch from "no id", because they are separate mistakes and the remedy differs.
  // The check above is a FALSITY test, and for as long as it was the only one, `true`, `{}` and
  // `[]` — all truthy — went straight into a written store: `id: true` migrated at exit 0, passed
  // `validate` at exit 0, and was served by `ready` as real work under the id `backlog/true`.
  //
  // It runs HERE, in the projection loop, and that placement is load-bearing: `projectLive` is
  // called at :836 and the archive is copied at :865, so a refusal here still leaves no trace.
  // The same value reaching `dumpTasks` instead threw `a.id.localeCompare is not a function`
  // AFTER the archive was on disk — which left a store that EXISTS, is EMPTY, and answers
  // `ready` with a confident empty backlog at exit 0. That is the founding defect, manufactured
  // by this migrator's own failure path, and it is the state the archive-last comment at :848
  // says the ordering exists to prevent.
  //
  // `renderRejected`, not interpolation: `${aDate}` is locale- and timezone-dependent, so the
  // same bad record reads differently here and on CI. format.js owns that rendering.
  if (!isUsableBdId(r.id)) {
    throw new InputError(
      `bd record with an unusable id ${renderRejected(r.id)} — cannot become a task`,
      `An id must be a string matching ${ID_RE.source}. This one would be written into a row,\n` +
      'into a `decisions/<id>.md` filename, and into every edge that names it.\n' +
      'Fix the id in bd, then re-run.',
      'EUSAGE'
    );
  }

  // `deferred` is special-cased ahead of STATUS_MAP, deliberately: the schema has it as a
  // FIRST-CLASS status (VALID_STATUSES), and `migrate.spec.js` pins 'deferred survives as
  // deferred' — the real migrator preserves it rather than approximating. STATUS_MAP's
  // `deferred: 'cancelled'` entry is the SPIKE's (bd-map.js projectRecords) approximation.
  const status = r.status === 'deferred' ? 'deferred' : (hasOwn(STATUS_MAP, r.status) ? STATUS_MAP[r.status] : undefined);

  // TWO GUARDS ON TWO DIFFERENT AXES, and this is the second one. `hasOwn` above guards the
  // KEY — it is what survives a hostile `status` out of a foreign JSONL, and it is what closed
  // the `TYPE_MAP['constructor']` hole. It says NOTHING about the value it just handed back.
  //
  // The value's other guard is the `@satisfies` cast on the map, and it is COMPILE-TIME — so it
  // is worth nothing to anyone who does not run the gate, which is the case this exists for.
  //
  // Do not overstate it in the other direction either. The cast does fail open on a misspelled
  // tag (`@satisifes` is silently ignored, where a misspelled TYPE is a hard error) — but
  // MEASURED, misspelling it and planting `type: 'bugg'` still gave tsc exit 2, because the
  // value flows into a `TaskType`-typed slot downstream and is caught there instead. So the
  // argument for this guard is NOT "tsc would miss it". It is that tsc is not run by everyone,
  // and this is the path that WRITES a store.
  //
  // Measured, before this guard, with `bug: { type: 'bugg' }` hand-patched into TYPE_MAP:
  // migrate wrote `type: bugg` into tasks-backlog.yml, printed "migrated 1 live issues" and the
  // written-files list, and EXITED 0. `diarie validate` then reported 1 error — so the store
  // this migrator had just certified as written was already invalid, and only a separate
  // command run afterwards could say so. A migrator whose success report is not evidence of a
  // valid store is the founding defect at one remove.
  //
  // BOTH or NEITHER: restoring one and leaving the other is worse than neither, because it
  // makes the remaining hole look considered.
  if (status && !isStatus(status)) {
    throw new InputError(
      `STATUS_MAP maps bd status ${renderRejected(r.status)} to ${renderRejected(status)}, which is not a task status`,
      'This is a bug in the map, not in your export — the KEY was found and its VALUE is invalid.\n' +
      'Fix STATUS_MAP in lib/migrate/bd-map.js; nothing has been written.',
      'EUSAGE'
    );
  }

  if (!status) {
    // NAME THE VOCABULARY. "unmapped bd status" and nothing else leaves the reader — often an
    // agent holding only this string — to go find the accepted set before it can act, and the
    // set is sitting right here.
    //
    // DERIVED from STATUS_MAP, never restated. `deferred` is special-cased above rather than
    // read from the map, which makes it look like it needs adding to this list by hand — it
    // does not: it is a STATUS_MAP key too (the special case overrides the map's value, not its
    // membership), and appending it printed "deferred, deferred" in the first run of this code.
    throw new InputError(
      `unmapped bd status for ${r.id}: ${renderRejected(r.status)}`,
      `Accepted bd statuses: ${Object.keys(STATUS_MAP).toSorted().join(', ')}.\n` +
      'Change the status in bd and re-run — or, if this is a status bd genuinely emits,\n' +
      'add it to STATUS_MAP in lib/migrate/bd-map.js.',
      'EUSAGE'
    );
  }

  const mapped = hasOwn(TYPE_MAP, r.issue_type) ? TYPE_MAP[r.issue_type] : undefined;

  // The other half — see the STATUS_MAP guard above for why the key check does not cover this.
  // `mapped.type` is what reaches the written row, so this is the value that decides whether the
  // store this command reports as written is one `diarie validate` will accept.
  if (mapped && !isTaskType(mapped.type)) {
    throw new InputError(
      `TYPE_MAP maps bd issue_type ${renderRejected(r.issue_type)} to ${renderRejected(mapped.type)}, which is not a task type`,
      'This is a bug in the map, not in your export — the KEY was found and its VALUE is invalid.\n' +
      'Fix TYPE_MAP in lib/migrate/bd-map.js; nothing has been written.',
      'EUSAGE'
    );
  }

  if (!mapped) {
    throw new InputError(
      `unmapped bd issue_type for ${r.id}: ${renderRejected(r.issue_type)}`,
      `Accepted bd issue types: ${Object.keys(TYPE_MAP).toSorted().join(', ')}.\n` +
      'Change the type in bd and re-run — or, if this is a type bd genuinely emits,\n' +
      'add it to TYPE_MAP in lib/migrate/bd-map.js.',
      'EUSAGE'
    );
  }

  // isStringArray, not Array.isArray: the latter narrows `unknown` to `any[]`, so a bd
  // export with `labels: [{...}]` would flow straight into `TaskRow.labels: string[]`
  // unchecked. (It fails later, at validate — but a migration that fails at the gate is a
  // migration you have to run twice.)
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
    // An edge pointing nowhere is not an edge. Report it rather than pushing `undefined`
    // into deps, where it would serialize as a null and dangle at validation.
    // The TYPE, not just the truthiness — and it routes to the malformed-edge branch that was
    // already here rather than a new one, because an unusable target IS a malformed edge. Left
    // as a falsity check, an object target fell through to the liveness branches below and the
    // report then asserted something false about it: `x-2 → [object Object] (blocks; satisfied:
    // blocker not live)` — a liveness claim about a value that was never an id. The migrator
    // stating a specific wrong thing is worse than stating nothing, and a human is the only
    // consumer here (migrate has no machine success payload).
    if (!isUsableBdId(d.depends_on_id)) {
      droppedEdges.push(
        `${r.id} → ${isNil(d.depends_on_id) ? '(no target)' : renderRejected(d.depends_on_id)} ` +
        `(${d.type ?? 'unknown'}; malformed edge — not a usable id, so its liveness was never asked)`
      );
      continue;
    }
    const live = liveIds.has(d.depends_on_id);
    if (d.type === 'blocks') {
      if (live) deps.push(d.depends_on_id);
      else droppedEdges.push(`${r.id} → ${d.depends_on_id} (blocks; satisfied: blocker not live)`);
    } else if (d.type === 'parent-child') {
      if (live) parent = d.depends_on_id;
      else droppedEdges.push(`${r.id} → ${d.depends_on_id} (parent; dropped: epic not live)`);
    } else {
      // bd has edge types beyond `blocks` and `parent-child` (`related`,
      // `discovered-from`, …). They have no analog in the schema, so dropping them is
      // right — dropping them SILENTLY is not. Without this branch the tool that WRITES
      // was strictly less honest than the read-only spike that only previews, which
      // already accumulates them as `untranslatedDepTypes`. The export this was first
      // written against happened to carry none of these edge types — which is exactly why
      // the branch was missing, and exactly why a foreign export needs it.
      droppedEdges.push(`${r.id} → ${d.depends_on_id} (${d.type ?? 'unknown'}; untranslated edge type — no schema analog)`);
    }
  }

  const { acceptanceCriteria, description } = splitBody(r.description ?? '');

  // UNION, never replace. bd carries acceptance criteria in TWO places — a standalone
  // `acceptance_criteria` field and an `## Acceptance Criteria` section in the body — and a
  // record can populate either or both. Reading only the body is what this migrator did until
  // 2026-07-28, and it cost 22 of 41 tasks their criteria on the first foreign export it met
  // (see the note on BdIssue). Letting one source win would just move the loss rather than end
  // it, so both are merged and de-duplicated.
  const criteria = [...new Set([...acceptanceCriteria, ...bdCriteria(r.acceptance_criteria)])];

  // `notes` and `design` are free prose with no field of their own in diarie's 4-type schema.
  // They go into `description` under their own headings rather than being dropped: the schema
  // already treats `description` as the free-text home, `splitBody` already round-trips `##`
  // sections out of it, and prose that survives in the store beats prose that survives only in
  // `_archive/bd-final-export.jsonl` — which nobody opens.
  //
  // GUARDED, not trusted, exactly as `acceptance_criteria` is: this is a foreign export whose
  // writes are dead, so its shape is something to survive rather than to insist on. `r.notes`
  // typed as `string` and called with `.trim()` crashed on any export that put a number or an
  // object there — a TypeError, which is not an `InputError`, so cli.js answers it with a
  // stack trace and an empty stdout. A non-string is now REPORTED rather than merely survived:
  // `bdProse` declines it via `placesProse`, and the census gates these fields on that same
  // predicate, so the run refuses (ELOSSY) instead of writing a row with the prose missing.
  const body = [
    description,
    ...bdProse('Notes', r.notes),
    ...bdProse('Design', r.design),
  ].filter(Boolean).join('\n\n');

  // An unmappable priority is the ONE field here that degrades instead of halting, and
  // that is the right call — `medium` is a defensible default and priority affects only
  // ORDERING, never correctness. But it must still be SAID. Priority is the ready-queue's
  // sort key, so a silent coercion quietly reorders the target repo's backlog, and the
  // read-only spike this migrator replaced already reported it (bd-map.js's
  // `priorityDefaultedIds`) while the shipped tool did not. Report-and-continue is the
  // policy; reporting is not the optional half.
  // `String()`, not a truthiness check: bd priority is numeric 0–4, and `0` is falsy —
  // `r.priority ? …` would silently coerce priority 0 (critical) to the medium default.
  const rawPriority = String(r.priority);
  const priority = hasOwn(PRIORITY_MAP, rawPriority) ? PRIORITY_MAP[rawPriority] : undefined;
  if (!priority) priorityDefaulted.push(`${r.id} (bd priority: ${JSON.stringify(r.priority)}) → medium`);

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
    priority: priority ?? 'medium',
  };
  if (labels.length) task.labels = labels;
  if (parent) task.parent = parent;
  if (deps.length) task.deps = deps;
  if (criteria.length) task.acceptance_criteria = criteria;
  if (body) task.description = body;
  if (r.updated_at) task.updated = r.updated_at.slice(0, 10);
  return task;
}

/**
 * Route each task to a slug. A task lands in an epic's slug if it IS that epic
 * or descends from it (transitively — a grandchild follows its grandparent);
 * everything else falls to `defaultSlug`.
 *
 * @param {TaskRow[]} tasks projected live rows (decisions already removed)
 * @param {Map<string, string>} epicSlugs epic id → slug
 * @param {string} defaultSlug
 * @returns {Map<string, TaskRow[]>} slug → tasks
 */
export function groupTasks (tasks, epicSlugs, defaultSlug) {
  const byId = new Map(tasks.map(t => [t.id, t]));

  /**
   * Walk up the parent chain to the first id with an explicit slug.
   *
   * @param {TaskRow} task
   * @returns {string} the slug it routes to
   */
  const slugFor = (task) => {
    /** @type {Set<string>} */
    const seen = new Set();
    /** @type {TaskRow | undefined} */
    let cur = task;
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id); // a parent cycle would otherwise spin here
      const slug = epicSlugs.get(cur.id);
      if (slug) return slug;
      cur = cur.parent ? byId.get(cur.parent) : undefined;
    }
    return defaultSlug;
  };

  const grouped = new Map(
    [defaultSlug, ...epicSlugs.values()]
      .map(s => /** @type {[string, TaskRow[]]} */ ([s, []]))
  );

  for (const task of tasks) {
    const slug = slugFor(task);
    const bucket = grouped.get(slug);

    // A `?.push()` here would silently DISCARD a migrated task if this invariant ever
    // broke — in a file whose stated failure mode is silent data loss. Refuse instead.
    if (!bucket) throw new Error(`internal: no bucket for slug "${slug}" — refusing to drop task ${task.id}`);

    bucket.push(task);
  }

  return grouped;
}

/**
 * Serialize a tasks file with a stable, diff-friendly key order.
 *
 * @param {string} slug
 * @param {string} title
 * @param {TaskRow[]} tasks
 * @returns {string}
 */
function dumpTasks (slug, title, tasks) {
  const ordered = tasks.toSorted((a, b) => a.id.localeCompare(b.id));
  return yaml.dump({ meta: { slug, title }, tasks: ordered }, { lineWidth: 100, noRefs: true });
}

/**
 * Serialize a decision to frontmatter'd markdown (its prose has no YAML home).
 *
 * ONE ARGUMENT, AND THAT IS THE FIX. This took a separate `body` alongside the task, and the
 * caller passed the RAW `r.description` while `projectLive` had already composed the real one
 * — description + `## Notes` + `## Design` — into `task.description`. So this function
 * destructured the composed body off and wrote the raw one instead, and every migrated
 * decision lost its `notes` and `design`. On the HAPPY PATH, with well-formed string input,
 * at exit 0, with no residue report and no ELOSSY.
 *
 * Reproduced with two records carrying identical `notes`/`design` and differing only in
 * `issue_type`: the task kept both under their headings, the decision kept neither. And a
 * decision is the record type whose ENTIRE content is prose — one carrying `notes`/`design`
 * and no `description` produced frontmatter and a completely empty body.
 *
 * Two arguments that must agree is a contract nothing can enforce. One value makes the
 * disagreement unrepresentable, which is why the fix belongs here and not at the call site.
 * The same single token also caused the `## Acceptance Criteria` section to be written twice
 * — once as frontmatter, once still inline in the raw prose.
 *
 * @param {TaskRow} task
 * @returns {string}
 */
function dumpDecision (task) {
  const { description, ...front } = task;
  const fm = yaml.dump(front, { lineWidth: 100, noRefs: true }).trimEnd();
  // normalizeBody, not the raw description: a decision is ENTIRELY prose, so an unnormalized
  // escaping artifact turns the whole file into one line of `\n` gibberish.
  return `---\n${fm}\n---\n\n${normalizeBody(description ?? '').trim()}\n`;
}

/**
 * Parse repeatable `key=value` flags (`--epic id=slug`, `--title slug=text`).
 *
 * @param {string[]} pairs
 * @param {string} flag flag name, for the error message
 * @returns {Map<string, string>}
 */
function parsePairs (pairs, flag) {
  /** @type {Map<string, string>} */
  const map = new Map();
  for (const pair of pairs) {
    const at = pair.indexOf('=');
    if (at < 1 || at === pair.length - 1) {
      throw new InputError(`--${flag} expects <key>=<value>, got: ${pair}`, USAGE, 'EUSAGE');
    }
    map.set(pair.slice(0, at), pair.slice(at + 1));
  }
  return map;
}

// --- CLI -------------------------------------------------------------------

// eslint-disable-next-line jsdoc/require-returns
/** @param {string[]} args */
function runMigrationParseArgs (args) {
  return parseArgs({ args, allowPositionals: true, options: MIGRATE_OPTIONS });
}

/**
 * Run the bd → flat-YAML migration.
 *
 * Exposed as a function so `diarie migrate` can call it directly instead of
 * re-implementing 170 lines of guards that already caught a data-loss bug. The
 * file's own CLI entry (below) is a thin caller of the same thing, which is what
 * keeps this honest: there is one migrator, not a library and a drifting copy.
 *
 * @param {string[]} args  argv after the command name
 * @returns {Promise<void>}
 */
export async function runMigration (args) {
  // parseArgs is strict: an unknown flag throws ERR_PARSE_ARGS_UNKNOWN_OPTION. That is a user
  // mistake, not a bug, so re-throw it as an InputError — otherwise it sails into cli.js's
  // "genuinely unexpected" branch and is answered with a stack trace, the exact defect this row fixes.
  /** @type {string[]} */
  let positionals;
  /** @type {ReturnType<typeof runMigrationParseArgs>['values']} */
  let values;

  try {
    ({ positionals, values } = runMigrationParseArgs(args));
  } catch (cause) {
    throw new InputError(
      cause instanceof Error ? cause.message : 'bad migrate arguments',
      USAGE, 'EUSAGE',
      { cause: cause instanceof Error ? cause : undefined }
    );
  }

  const [inputPath, ...extraPaths] = positionals;
  if (!inputPath) {
    throw new InputError('migrate needs a bd export file', USAGE, 'EUSAGE');
  }

  // MIGRATE IS THE ONE COMMAND THAT KEEPS `allowPositionals: true`, because its positional IS
  // the bd export file. So the four peowly commands' blanket refusal cannot cover it, and the
  // silent-discard bug lived here in its own form: `const [inputPath] = positionals` took the
  // first and dropped the rest without a word. `diarie migrate first.json second.json` reported
  // only on `first.json` and never mentioned `second.json` — and this command WRITES A STORE,
  // so a caller who believed both were consumed gets a migration missing half its input, at
  // exit 0, with the store already on disk.
  //
  // Refuse rather than guess which one was meant. Merging two exports is not a thing this
  // migrator does, and picking the first is an answer nobody asked for. Naming the dropped
  // tokens is the house rule (a refusal quotes back what it rejected) and is what tells a
  // caller whether they hit a shell glob or a typo.
  if (extraPaths.length > 0) {
    throw new InputError(
      `migrate takes ONE bd export file, but ${positionals.length} were given — ` +
      `\`${extraPaths.join('`, `')}\` would have been ignored. ` +
      'Migrate them one at a time, or merge the exports first.',
      USAGE, 'EUSAGE'
    );
  }

  // Default to CWD, never to this package's own checkout: the migrator is installed
  // somewhere and run against OTHER repos, so a script-relative default would make a
  // forgotten --root silently clobber the tracker of whatever tree the code happens to
  // live in — the installing package's own store, not the user's.
  //
  // And `--root` or cwd is the WHOLE list: no `DIARIUM_ROOT`, no environment of any kind,
  // deliberately. This is the one command that writes a store from nothing, so the set of
  // things that can aim it stays as small and as visible as possible — an exported variable
  // in some ancestor shell is exactly the invisible aimer this guard exists to exclude.
  // (Consequence worth knowing: a stale `TASKS_ROOT`, which the READERS reject outright,
  // is simply not read here. It never was.)
  const root = resolve(values.root ?? cwd());

  // "Not read" and "not mentioned" are different things, and only the first one is decided
  // above. A set `DIARIUM_ROOT` aims every OTHER diarie command at a particular project;
  // whoever exported it reasonably expects it to aim this one too, and it does not. So it is
  // REPORTED rather than obeyed — collected here, beside the decision it qualifies, and
  // printed further down where stdout is safe (a write before the refusals would break the
  // JSON error contract). Only a value that DISAGREES with where we are writing is worth a
  // line: one that already points here is not a surprise anyone needs told about.
  const ignoredEnvRoots = ROOT_ENV_NAMES.flatMap(name => {
    const value = env[name];
    return value && resolve(value) !== root ? [`${name}=${value}`] : [];
  });

  const epicSlugs = parsePairs(values.epic, 'epic');
  const titles = parsePairs(values.title, 'title');
  const defaultSlug = values['default-slug'];

  // WHAT IS ON DISK DECIDES THE POSTURE. `--dotted` chooses only when there is nothing to
  // find. Deriving the name from the flag alone is what turned `--force` — documented right
  // below as "redo a botched migration" — into "write a SECOND store": point migrate at a repo
  // whose store is `.diarium/`, leave the flag off, and it created `diarium/` beside it,
  // exited 0 and reported success, while the next `diarie ready` in that repo hard-failed
  // ETWOSTORES with the real backlog unreadable.
  //
  // `trackerDirIn` throws ETWOSTORES here, BEFORE `--force` is read, and the ordering is the
  // point: `--force` answers "overwrite THIS store?", and with both forms present there is no
  // "this" — the flag could only license a guess. (That state used to surface as EEXIST,
  // which says "a store is in the way" about a situation whose actual problem is that there
  // are two of them.)
  const existing = trackerDirIn(root);
  const legacy = legacyTrackerDirIn(root);
  const storeName = existing?.name ?? defaultTrackerDir(values.dotted);

  // `--dotted` naming the other form of a store that already exists is a contradiction, not a
  // conversion request: the pair is one store and posture flips with `git mv`, never with a
  // flag (decision `diarie-pos`). Obeying the flag writes a second store; ignoring it drops
  // an explicit instruction without a word. So refuse, and name the rename for whoever did
  // mean to flip.
  if (values.dotted && existing && existing.name !== defaultTrackerDir(true)) {
    throw new InputError(
      `--dotted, but ${existing.path} is already this project's store`,
      'The pair is one store, not two, and the posture is changed by MOVING it rather than by\n' +
      `re-migrating:  git mv ${existing.path} ${resolve(root, defaultTrackerDir(true))}\n` +
      'Drop --dotted to migrate into the store that is there.',
      'EUSAGE'
    );
  }

  // The migration is a BOOTSTRAP: after it runs, the store is hand-maintained with
  // Edit/Write. Re-running would silently overwrite that work with the export's
  // (stale) state, so an existing store is a hard stop rather than a doc warning.
  //
  // EVERY name is checked — both forms of the pair AND the retired ones. Checking only the
  // form this run intends to write is the subtle version of not checking at all: find nothing
  // at `diarium/tasks`, conclude the project is fresh, and write a second store beside a
  // backlog full of real work. The guard would still be there, still passing, and no longer
  // guarding anything.
  //
  // The STORE DIRECTORY is what triggers this, not the task files inside it. Counting files
  // meant an existing store whose `tasks/` was empty — a fresh `diarie init`, or a project
  // that keeps only decisions — read as "no store here", so migrate wrote its own beside it.
  // `init` refuses that exact disk state; two store-creating commands disagreeing about what
  // a store is, is how you end up with two.
  const occupied = [existing, legacy].filter(store => store !== undefined);

  if (occupied.length && !values.force) {
    throw new InputError(
      'refusing to overwrite an existing task store: ' +
      occupied.map(({ path }) => {
        const files = taskFilesIn(path);
        return files.length
          ? `${path} already holds ${files.join(', ')}`
          : `${path} already exists (no task files in it yet — but it IS the store, and a second one beside it is two stores)`;
      }).join('; '),
      'This is a one-way bootstrap, not a sync — re-running replays the bd export over any hand-edits\n' +
      'made since. Pass --force only to redo a botched migration, or --root <dir> to target elsewhere.',
      'EEXIST'
    );
  }

  // Something occupying the store path that is NOT a store — a plain file, a broken symlink.
  // `trackerDirIn` refuses to call that a store, so the guards above see an empty root and
  // the run proceeds to `mkdirSync`, which answers ENOTDIR: not an `InputError`, therefore a
  // stack trace on stderr and an unparseable stdout for a `--json` caller. Refused here,
  // beside the other refusals, so nothing has been written when it fires.
  assertStorePathFree(root, storeName);

  for (const slug of [...epicSlugs.values(), defaultSlug]) {
    if (!SLUG_RE.test(slug)) {
      throw new InputError(`invalid slug "${slug}" — must match ${SLUG_RE} (it becomes tasks-<slug>.yml)`, USAGE, 'EUSAGE');
    }
  }

  const write = (/** @type {string} */ relPath, /** @type {string} */ content) => {
    const abs = resolve(root, relPath);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
    return relPath;
  };

  // Pointing at a file that is not there is the archetypal user mistake — the whole thesis of
  // this row. readFileSync throws a raw ENOENT, which cli.js can only answer with a stack trace;
  // convert it to an InputError. A non-ENOENT read failure (permissions, is-a-directory) IS
  // unexpected enough to keep its stack, so re-throw those untouched.
  /** @type {string} */
  let raw;
  try {
    raw = readFileSync(inputPath, 'utf8');
  } catch (cause) {
    if (cause instanceof Error && /** @type {NodeJS.ErrnoException} */ (cause).code === 'ENOENT') {
      throw new InputError(`no such bd export file: ${inputPath}`, USAGE, 'EUSAGE', { cause });
    }
    throw cause;
  }
  // One checked parse boundary, shared with the spike — see parseBdExport. Before it, the
  // rows were `any`, so `BdIssue` bound to nothing and tsc checked this migrator against
  // a shape it had never actually seen.
  const records = parseBdExport(raw);

  const live = records.filter(r => r.status !== 'closed');

  // THE FIELD CENSUS, and it runs BEFORE anything is written — a refusal here must leave no
  // trace, for the same reason the archive is written last (see the comment there).
  //
  // Only the LIVE records are censused: closed issues never become rows, so a field only they
  // carry is not something this migration loses.
  //
  // Why this exists at all: until 2026-07-28 this migrator read acceptance criteria only out of
  // the markdown body and never touched bd's standalone `acceptance_criteria` field. On the
  // first foreign export it met, 22 of 41 live tasks lost their criteria — including that
  // project's release gate — and the run exited 0 with `diarie validate` passing afterwards.
  // The fix that mattered was not "also read that field"; it was making it impossible for the
  // NEXT unread field to be silent. So the check is driven by the keys present in the data, not
  // by a list someone maintains.
  const { ignored: ignoredFields, residue, unplaceable } = censusFields(live, PLACED_BY);

  // THE REFUSAL RUNS FIRST, and nothing may touch stdout before it. Under `--json` the error is
  // emitted as JSON on stdout by cli.js's boundary, so a human-readable line printed here ahead
  // of the throw lands in front of that JSON and makes it unparseable — the caller's `jq` fails,
  // it falls back to "no data", and a refusal reads as a success with nothing to say. Caught by
  // the test below, not by review.
  if (residue.size || unplaceable.size) {
    // Sorted BY FIELD NAME. A bare `.toSorted()` on `[key, value]` entries compares their
    // string coercions — `"field,id1,id2"` — so the ids join the sort key and the ordering is
    // only accidentally alphabetical.
    //
    // Full ids, never a truncated sample. This command runs ONCE per project, so there is no
    // verbosity budget to protect and every omission costs the reader the one chance they get
    // to see what they are about to lose.
    /** @type {(m: Map<string, string[]>, suffix?: (field: string) => string) => string} */
    const detailOf = (m, suffix) => [...m]
      .toSorted(([a], [b]) => a.localeCompare(b))
      .map(([field, ids]) => `  ${field} — ${ids.length} record(s): ${ids.join(', ')}${suffix ? suffix(field) : ''}`)
      .join('\n');

    // TWO CAUSES, TWO REMEDIES, and keeping them apart is the point of the split. The old
    // single message said every dropped field had "no home in the store" and told the reader to
    // move the content into the description — true and actionable for `defer_until`, and flatly
    // wrong for `notes: {…}`, whose home exists and whose problem is the shape sitting in it.
    // A refusal that names the wrong cause sends the reader to fix the wrong thing, which is a
    // more expensive failure than saying less.
    const sections = [];

    if (residue.size) {
      sections.push(
        `${residue.size} field(s) have no home in the store:\n${detailOf(residue)}\n\n` +
        '  These carry content this migrator cannot place anywhere.\n' +
        '  Move what matters into the description or acceptance criteria in bd first.'
      );
    }
    if (unplaceable.size) {
      sections.push(
        `${unplaceable.size} field(s) have a home, but not for the shape they carry here:\n` +
        // hasOwn-guarded, as every lookup keyed by a foreign export's field name is here: the
        // field reached this map from the census, so it IS a PLACED_BY key — but a bare index
        // would say so on `'constructor'` too, and this one is building the remedy text.
        `${detailOf(unplaceable, f => (hasOwn(PLACED_BY, f) ? ` · placed only from ${PLACED_BY[f].accepts}` : ''))}\n\n` +
        '  The field is known and would be carried — this VALUE is the part that cannot be read,\n' +
        '  so it would vanish with the row still migrating cleanly. Flatten it to text in bd first.'
      );
    }

    const detail = sections.join('\n\n');
    // A plain SUM, and it cannot double-count: the census branches on whether the KEY is in
    // CONSUMED_BD_FIELDS, which is a property of the field name and not of the record, so a
    // given name takes the same branch for every record in the export. The two maps are
    // therefore disjoint by construction rather than by luck, and no field can be counted in
    // both. Worth stating, because a sum over two collections normally deserves the suspicion.
    const total = residue.size + unplaceable.size;

    if (!values.lossy) {
      throw new InputError(
        `refusing to migrate: ${total} field(s) in this export would be lost`,
        `${detail}\n\n` +
        'Nothing has been written. Fix the export and re-run — or pass --lossy to migrate anyway\n' +
        '(the full export is still archived alongside the store).',
        'ELOSSY'
      );
    }
    // STDOUT, and this was the sharpest inversion in the file: the harmless "nothing is lost"
    // report below goes to stdout while THE DATA-LOSS WARNING went to stderr — the streams
    // ordered by the exact inverse of importance, on the stream this package's own founding
    // paragraph calls "a stream that ten call sites pipe to /dev/null". `--lossy` also exits
    // 0, so the exit code carries nothing either: a caller who redirected stderr saw a clean
    // success and never learned which fields it had just agreed to lose.
    //
    // Every other loss report in this migration — dropped edges, dropped labels, coerced
    // priorities — is already on stdout. This one was the outlier, and it is the one that
    // costs the most.
    stdout.write(`\nwarning: --lossy — ${total} field(s) are being dropped:\n${detail}\n`);
  }

  // Past the CENSUS refusal, so stdout is safe for everything the migration itself reports.
  //
  // NOT past every refusal in this function, and an earlier version of this comment claimed it
  // was. The GITIGNORED hard stop near the end throws an InputError after ~20 stdout writes, so
  // under `--json` a caller gets prose and then a JSON error — unparseable, which is the founding
  // defect wearing the exit code that reports it. That ordering predates this branch and is
  // tracked as `diarie-gig`; do not restore the absolute claim, because the next person to read
  // it would place a refusal below here on the strength of it.
  //
  // What `--force` waved past, said out loud. Overwriting the store you are already in is the
  // documented use; writing BESIDE a store that keeps its old name is a different act, and
  // leaves the repo in a state a reader will not thank you for. The flag licenses both — it
  // does not get to make either one quiet.
  for (const { path } of values.force ? occupied : []) {
    stdout.write(path === resolve(root, storeName)
      ? `--force: rewriting the store already at ${path}\n`
      : `--force: ${path} left in place, and a store written at ${resolve(root, storeName)} beside it — ` +
        'sort that out before committing (`git mv` one onto the other, or delete the stale one)\n');
  }
  if (ignoredEnvRoots.length) {
    stdout.write(`note: migrate reads no environment — ${ignoredEnvRoots.join(', ')} ignored, writing into ${root}\n`);
    stdout.write('  (pass --root to aim it elsewhere)\n');
  }
  if (ignoredFields.size) {
    stdout.write('not carried over (no home in the schema; nothing authored is lost):\n');
    for (const [field, count] of [...ignoredFields].toSorted(([a], [b]) => a.localeCompare(b))) {
      // hasOwn-guarded object access: IGNORED_BD_FIELDS is a plain const object (not a Map),
      // and hasOwn also narrows `field` to its keys for the type-checker.
      stdout.write(`  ${field} — ${count} record(s) · ${hasOwn(IGNORED_BD_FIELDS, field) ? IGNORED_BD_FIELDS[field] : ''}\n`);
    }
  }
  // The filter is not cosmetic: `BdIssue.id` is optional (bd's export is foreign and we do not
  // get to insist on it), so an unusable row would otherwise put a non-id into liveIds and make
  // every edge-liveness check nonsense. `projectLive` refuses such a row anyway — this keeps
  // the set honest in between.
  //
  // `isUsableBdId` rather than truthiness is also what EARNS the annotation below. A `Set<string>`
  // over a raw `r.id ? …` filter was an invariant asserted at the one place nothing established
  // it: tsc accepted it only because `BdIssue.id` is DECLARED `string | undefined`, and a `{}`
  // satisfied the filter and the declaration alike.
  /** @type {Set<string>} */
  const liveIds = new Set(live.flatMap(r => isUsableBdId(r.id) ? [r.id] : []));
  /** @type {string[]} */
  const droppedEdges = [];
  /** @type {string[]} */
  const priorityDefaulted = [];
  /** @type {string[]} */
  const droppedLabels = [];

  for (const epicId of epicSlugs.keys()) {
    // stdout: the consequence is a task file WRITTEN EMPTY, which the tally below reports as a
    // bare `0 → tasks-<slug>.yml` with no reason attached. The reason existed only here.
    if (!liveIds.has(epicId)) stdout.write(`warning: --epic ${epicId} is not a live issue — its slug will be empty\n`);
  }

  /** @type {TaskRow[]} */
  const tasks = [];
  /** @type {TaskRow[]} */
  const decisions = [];
  for (const r of live) {
    const task = projectLive(r, liveIds, droppedEdges, priorityDefaulted, droppedLabels);
    // THE BODY IS ALREADY IN `task.description` — do not pass `r.description` alongside it.
    // `projectLive` composes description + `## Notes` + `## Design` into `task.description`;
    // this call site used to hand `dumpDecision` the RAW `r.description` as a second argument,
    // and every migrated decision lost its notes and design as a result. Carrying one value
    // rather than two is what makes that unrepresentable.
    if (task.type === 'decision') decisions.push(task);
    else tasks.push(task);
  }

  const grouped = groupTasks(tasks, epicSlugs, defaultSlug);

  // Archive the FULL snapshot — but ONLY NOW, once every record has projected without
  // refusing. It used to be written first, "so bd's history is safe" — and that created
  // the very defect this tracker exists to eliminate.
  //
  // `projectLive` THROWS on a record it cannot honestly migrate (no id, an unmapped
  // status). Archiving first meant an aborted migration still left a store behind —
  // a real directory, holding only the archive, with no tasks in it. The target repo then
  // had a store that EXISTS and is EMPTY, which is exactly the state we teach every
  // consumer to trust:
  //
  //   diarie ready    →  {"ready":[],"blocked":[],"needsAttention":[]}   exit 0
  //   diarie validate →  "Task validation passed (0 file(s))."           exit 0
  //
  // An honest ENOSTORE ("this project has no tracker") converted into a confident, empty,
  // entirely fictional backlog — by the failure path of the migrator itself. A migration
  // that refuses must leave NO TRACE, so the next attempt starts from an honest absence.
  mkdirSync(resolve(root, `${storeName}/_archive`), { recursive: true });
  copyFileSync(resolve(inputPath), resolve(root, `${storeName}/_archive/bd-final-export.jsonl`));

  const written = [
    ...[...grouped].map(([slug, slugTasks]) => write(
      `${storeName}/tasks/tasks-${slug}.yml`,
      dumpTasks(slug, titles.get(slug) ?? `Live work migrated from bd (${slug})`, slugTasks)
    )),
    ...decisions.map(task => write(`${storeName}/decisions/${task.id}.md`, dumpDecision(task))),
  ];

  stdout.write(`migrated ${live.length} live issues (of ${records.length} total):\n`);
  const tally = [...grouped].map(([slug, t]) => `${t.length} → tasks-${slug}.yml`).join(' · ');
  stdout.write(`  ${tally} · ${decisions.length} → ${storeName}/decisions/\n`);
  stdout.write(`  archived full snapshot → ${storeName}/_archive/bd-final-export.jsonl\n`);
  if (droppedEdges.length) {
    stdout.write(`  dropped ${droppedEdges.length} edge(s) to non-live issues:\n`);
    for (const d of droppedEdges) stdout.write(`    - ${d}\n`);
  }
  if (droppedLabels.length) {
    // Not cosmetic: a dropped `epic` label un-contains an epic in the MIGRATED repo.
    stdout.write(`  dropped ${droppedLabels.length} malformed labels list(s) — a lost \`epic\` label makes a container workable again:\n`);
    for (const l of droppedLabels) stdout.write(`    - ${l}\n`);
  }
  if (priorityDefaulted.length) {
    // Priority is the ready-queue's sort key, so this is not cosmetic: it means the
    // migrated backlog may not come out in the order bd would have given it.
    stdout.write(`  coerced ${priorityDefaulted.length} unmappable priority/-ies to medium (affects ready ORDER):\n`);
    for (const p of priorityDefaulted) stdout.write(`    - ${p}\n`);
  }
  stdout.write(`written:\n${written.map(w => `  ${w}`).join('\n')}\n`);

  // `git add -A` skips an ignored file WITHOUT A WORD, and `*.jsonl` / `_archive/`
  // are unremarkable .gitignore lines — so ask git what it would actually commit
  // rather than trusting the layout. The two halves carry very different stakes.
  const archive = `${storeName}/_archive/bd-final-export.jsonl`;
  const check = spawnSync('git', ['-C', root, 'check-ignore', '--stdin'], {
    input: [...written, archive].join('\n'),
    encoding: 'utf8',
  });
  // exit 0 = something matched an ignore rule; 1 = nothing ignored; 128 = not a repo.
  const ignored = check.status === 0 ? check.stdout.split('\n').filter(Boolean) : [];
  const storeIgnored = ignored.filter(f => !f.includes('_archive'));
  const archiveIgnored = ignored.some(f => f.includes('_archive'));

  // The live store being ignored is not a policy question — it means the migration
  // produced nothing durable. Hard stop.
  if (storeIgnored.length) {
    throw new InputError(
      `the migrated task store is GITIGNORED in ${root} — it will not commit`,
      storeIgnored.map(f => `      ${f}`).join('\n') + '\n' +
      // The "it's dotted, so something probably swept it up" hint only applies to the
      // dotted posture. Said of a visible `diarium/` it would be simply false, and would
      // send the reader hunting for a dotfile rule that is not what ignored their store.
      (storeName.startsWith('.')
        ? `    ${storeName}/ is dotted but MUST be tracked — it IS the backlog. A negation\n`
        : `    ${storeName}/ MUST be tracked — it IS the backlog. A negation\n`) +
      // `!<dir>/` does NOT work: git will not descend into an excluded directory, so a
      // negation on the dir alone can never re-include the files under it. `/**` can.
      `    line works: !${storeName}/**`,
      'EUSAGE'
    );
  }

  // The ARCHIVE is a judgment call, and git already knows the answer. Whether the
  // project ever TRACKED `.beads/` is its revealed preference on versioning bd history:
  // a gitignored `.beads/` means it chose not to, years ago. Committing a JSONL of the
  // closed issues now would quietly reverse that. So speak only when the migration
  // would CHANGE the status quo — never to push a default. (The file is written to disk
  // regardless: it costs nothing and bd's Dolt DB may not stay readable.)
  const beadsTracked = spawnSync('git', ['-C', root, 'ls-files', '.beads'], { encoding: 'utf8' });
  const historyWasVersioned = Boolean(beadsTracked.stdout?.trim());

  // All three branches on STDOUT. They are the last thing this command says about what it just
  // did to your repository, and one of them ("committing will put N closed issues into git for
  // the first time") is a policy change being made on the user's behalf. Splitting the trio by
  // tone — warning to stderr, notes to stdout — would recreate the thing that makes this class
  // of bug invisible: no rule a reader could apply to PREDICT which stream carries a given fact.
  if (archiveIgnored && historyWasVersioned) {
    // A real regression: they DID version bd history, and now it would stop.
    stdout.write(
      `\nwarning: this project tracks \`.beads/\` in git, but ${archive} is gitignored —\n` +
      '  so the bd history you have been versioning would stop being versioned here.\n' +
      `  Add !${archive} (or !${storeName}/**) to keep it.\n`
    );
  } else if (archiveIgnored) {
    stdout.write(
      `\nnote: ${archive} is gitignored — consistent with \`.beads/\`, which this project\n` +
      '  never tracked either. Nothing to do: closed issues record what was DONE (your git\n' +
      '  log and CHANGELOG already tell you that); the backlog is for what comes NEXT, and\n' +
      '  it commits normally. The archive still exists on disk if you ever want it.\n'
    );
  } else if (!historyWasVersioned) {
    // Not ignored, so it WOULD commit — but they never versioned bd history before.
    // Flag it as a new choice rather than letting it slip in.
    stdout.write(
      `\nnote: ${archive} is NOT gitignored, so committing will put bd's ${records.length - live.length}\n` +
      '  closed issues into git for the first time — this project never tracked `.beads/`.\n' +
      '  Fine if you want that history queryable; if not, drop the file or ignore it. Your call —\n' +
      '  git log and CHANGELOG usually already record what was done.\n'
    );
  }
}

// The file stays runnable on its own (the tests spawn it, and it predates the CLI). It has no
// cli.js boundary above it, so it needs its own: an InputError is a user mistake and gets its
// message (never a stack), mirroring cli.js's non-JSON branch. Anything else keeps its stack —
// that is the honest answer to a genuine bug. `--json` here is cli.js's job, not this legacy entry's.
if (argv[1] && fileURLToPath(import.meta.url) === argv[1]) {
  runMigration(argv.slice(2)).catch((/** @type {unknown} */ err) => {
    if (err instanceof InputError) {
      stderr.write(`diarie: ${err.message}\n`);
      if (err.body) stderr.write('\n' + err.body + '\n');
    } else if (err instanceof Error) {
      stderr.write(String(err?.stack ?? err) + '\n');
    } else {
      stderr.write(String(err) + '\n');
    }
    exit(1);
  });
}
