/**
 * schema.js — the single canonical schema for the flat-YAML task substrate.
 *
 * THIS IS THE AUTHORITY. `ready.js`, `validate.js`, the `store/` modules, the migrator, and every
 * downstream consumer derive their vocabulary from here — never fork it. The enum Sets
 * carry the runtime vocabulary; the matching `@typedef` unions carry the type-level
 * vocabulary, checked by the type-check gate.
 *
 * A `<store>/tasks/tasks-<slug>.yml` file is (`<store>` = `diarium/` or `.diarium/`):
 *
 *   tasks:                    # top-level: a list (required)
 *     - id: T-1               # unique within the file; namespaced to slug/id on load
 *       title: ...            # required
 *       status: pending       # required; one of VALID_STATUSES
 *       type: task            # required; one of VALID_TYPES (4 kinds — see below)
 *       priority: medium      # optional; one of VALID_PRIORITIES (default medium)
 *       labels: [bug]         # optional LIST of strings; framings live here, not in type
 *       parent: T-0           # optional; an id in the same or another (slug/id) file
 *       deps: [T-0]           # optional LIST; bare ids resolve to slug/id, `slug/id` pass through
 *       acceptance_criteria:  # optional LIST; the test-ratchet checks it on completed work
 *         - ...
 *       agent: loop-1         # optional; set when claimed (status in_progress)
 *       updated: "2026-06-10" # optional; ISO date — staleness is computed from it
 *       description: |        # optional; the free-text body (see note below)
 *         free-text body
 *
 * `description` is a RATIFIED optional field (2026-07-11). It was introduced by
 * the bd→YAML migration to preserve each issue's body losslessly, which reversed
 * the original no-body design (an earlier retrospective had deflated "missing body"
 * as by-design) — so it was held for a decision, and the decision is KEEP. The
 * evidence: every migrated task carried one, and they hold the *why* a title cannot
 * — an issue's provenance, and the scoping data behind its estimate. Dropping them
 * would have moved that context to an archive nobody reads while working.
 *
 * It stays OPTIONAL and free-text: a terse row is still a legitimate row, and the
 * ready computation ignores this field entirely (it is prose for humans, never a
 * computation input). If a future unknown-field warning is added to `validate`, it
 * must allowlist `description` or every migrated task will flag at once.
 *
 * Type model (2026-06-10): 4 exclusive kinds — `task` (work), `doc` (reference),
 * `decision` (record), `milestone` (marker). bd's other five types (`bug` /
 * `feature` / `chore` / `story` / `spike`) are FRAMINGS of `task`, carried in
 * `labels:`; `epic` is `task` + `parent:` nesting (or an `epic` label). The enum
 * stays exclusive (exactly one type per item — the property labels can't give);
 * the framings stay additive. A type answers "what kind of thing is this", which
 * admits exactly one answer; a label answers "how should I think about it", which
 * admits several. That is the whole argument for collapsing 9 types into 4.
 * Spike's "closes with findings, not code" semantics travel with the `spike` label.
 *
 * `doc` and `decision` do NOT live as rows in `tasks-<slug>.yml`; their
 * content-home is frontmatter'd markdown under `<store>/decisions/<id>.md`
 * and `<store>/docs/<id>.md` (the frontmatter carries the schema fields; the
 * body is the prose the terse row can't hold). `milestone` rows DO live in
 * `tasks-*.yml` (markers, no prose). Because the loader only globs `tasks-*.yml`,
 * decision/doc files are naturally outside the ready computation — a decision
 * "in force" is never surfaced as workable. (bd got this wrong: its ready-walk is
 * type-blind and lists decisions as ready work.)
 *
 * ⚠️ THE REASON GIVEN ABOVE IS CONTESTED AND WAS MEASURED FALSE — 2026-08-05, row `diarie-frm`.
 * "The prose the terse row can't hold" does not describe the data. Across two real stores, 182
 * rows carry a median of ~1.5k characters of prose with NONE under 100, and the largest row
 * (25,963 chars) holds 4.8× the largest record body. Neither store contains a single
 * `milestone`, so that arm of the mapping has no instance anywhere. The rule may well be RIGHT —
 * batching suits terse entities, files suit prose ones — but it is not right for the reason
 * stated here, and it is drawn per-TYPE while the property it appeals to belongs to an INSTANCE.
 * The structural guarantee in the paragraph above is a separate claim and remains TRUE; it is
 * also the strongest argument for keeping the coupling. `diarie-frm` decides.
 *
 * Ready rule (the only computation that gates work): an item is READY iff
 * `type === 'task'`, `status === 'pending'`, every dep is `completed`, AND it is not a
 * CONTAINER — a task with open children, or one carrying the `epic` label, is the sum of
 * its children and never work in itself. (Getting that wrong is a real bug with a real
 * symptom: an epic, having no dependencies of its own, is offered as the next thing to
 * work on, and the actual work — its children — is never surfaced.) Non-task types
 * (`doc`/`decision`/`milestone`) never appear in ready/blocked/needsAttention — they are
 * records or markers, not work (a milestone has "no effort, no assignment") — and for the
 * same reason they never BLOCK one either. Both `deps` (the `blocks` analog) and `parent`
 * (containment) affect readiness; transitivity is emergent via the status invariant (a
 * task can't be `completed` until it was itself ready), not a graph walk.
 *
 * Atomic-write contract (load-bearing invariant): the substrate assumes a SOLO,
 * SINGLE-HOST developer with NO concurrent writers to the same `tasks-<slug>.yml`.
 * Anything that fans work out in parallel must uphold that itself — partition by
 * file, one owner per slug, so two writers never hold the same `tasks-<slug>.yml`
 * at once. Writers mutate tasks by editing the YAML directly; there is deliberately
 * no CRUD helper (the store is a substrate, not a product with an opinion about how
 * you change it). If the invariant is ever violated (multi-writer), the upgrade is
 * write-then-rename, not a lock daemon.
 */

import { typedObjectKeys } from '@voxpelli/typed-utils';
import { extendedGuardedArrayIncludes } from './utils/type-utils.js';

/**
 * A task id that has been globalized into the `slug/id` namespace.
 *
 * A BRAND, not an alias. `GlobalId` is assignable to `string`, but a plain `string` is
 * NOT assignable to `GlobalId` — and the only thing that mints one is `nsId()` below.
 *
 * It exists because of a real bug. `loadTasks` globalized `id` and `deps` and left `parent`
 * raw, so `parent` could never equal any `id`. Every type involved was `string`, so nothing
 * complained. The container rule was the first code to trust `parent`, and it would have
 * found zero children for every epic, excluded nothing, and passed a green suite.
 *
 * `unknown` does NOT catch it — you satisfy `unknown` with `String(x)`, which is the bug.
 *
 * **A template-literal type `` `${string}/${string}` `` DOES catch it**, and an earlier
 * version of this comment claimed otherwise ("only a brand can…"). That was false, and it
 * was disproved by probe, not by argument: swapping the brand for the template type keeps
 * tsc at zero errors, keeps type-coverage identical, and still rejects the reverted bug.
 * The claim is corrected rather than quietly deleted, because a comment that overstates its
 * own guard is how the next reader gets talked out of a cheaper, better one.
 *
 * What the brand adds over the template type is **provenance, not detection**: any
 * `` `${a}/${b}` `` satisfies the template, whereas a `GlobalId` can only be minted by
 * `nsId()` below. Given that the whole bug was one caller globalizing by hand and another
 * forgetting to, "only nsId may produce these" is the property actually worth buying — but
 * it is a different property than the one that catches the typo, and they should not be
 * conflated.
 *
 * @typedef {string & { readonly __globalId: unique symbol }} GlobalId
 */

/**
 * A task AS WRITTEN TO DISK — the YAML row, before any loader has seen it.
 *
 * The distinction from `store/load-tasks.js`'s `Task` is not pedantry; it is the whole point of the
 * brand. A row on disk carries BARE ids (`T-1`, `parent: T-0`) which only mean anything
 * relative to their file's slug. A loaded `Task` carries `GlobalId`s (`alpha/T-1`). They
 * are different types that had both been called `string`, which is precisely how `parent`
 * came to be globalized in one place and not the other without anyone noticing.
 *
 * The migrator PRODUCES rows (it writes YAML). The readers CONSUME tasks. Nothing should
 * accept both.
 *
 * @typedef TaskRow
 * @property {string} id
 * @property {string} [title]
 * @property {Status} status
 * @property {Priority} [priority]
 * @property {TaskType} [type]
 * @property {string[]} [deps]
 * @property {string} [parent]
 * @property {string[]} [labels]
 * @property {string[]} [acceptance_criteria]
 * @property {string} [agent]
 * @property {string} [updated]
 * @property {string} [description]
 */

const VALID_PRIORITIES_MAP = /** @type {const} */ ({
  critical: true,
  high: true,
  medium: true,
  low: true,
  backlog: true,
});

/**
 * `deferred` is an open item consciously postponed — distinct from `cancelled`
 * (won't do) and from `pending` (workable now). Like every non-`completed`
 * status it is not `ready` and does not resolve a dependency: a task depending
 * on a deferred item surfaces in `needsAttention`, never `ready` (see
 * computeReady in ready.js — deferred falls through the dep partition's
 * catch-all `else` into `stalled`).
 */
const VALID_STATUSES_MAP = /** @type {const} */ ({
  pending: true,
  in_progress: true,
  completed: true,
  failed: true,
  cancelled: true,
  deferred: true,
});

const VALID_TYPES_MAP = /** @type {const} */ ({
  decision: true,
  doc: true,
  milestone: true,
  task: true,
});

/** @typedef {keyof typeof VALID_PRIORITIES_MAP} Priority */
/** @typedef {keyof typeof VALID_STATUSES_MAP} Status */
/** @typedef {keyof typeof VALID_TYPES_MAP} TaskType */

/** @type {ReadonlySet<Priority>} */
export const VALID_PRIORITIES = new Set(typedObjectKeys(VALID_PRIORITIES_MAP));
/** @type {ReadonlySet<Status>} */
export const VALID_STATUSES = new Set(typedObjectKeys(VALID_STATUSES_MAP));
/** @type {ReadonlySet<TaskType>} */
export const VALID_TYPES = new Set(typedObjectKeys(VALID_TYPES_MAP));

/** Priority sort order for the ready queue (lower = more urgent). */
export const PRIORITY_RANK = /** @satisfies {Record<Priority, number>} */(/** @type {const} */ ({
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  backlog: 4,
}));

/** Allowed shape of a task `id` (letters/digits then word chars, `.`, `-`). */
export const ID_RE = /^[A-Z0-9][\w.-]*$/i;

/** Always-required fields on every task entry. */
export const REQUIRED_FIELDS = /** @satisfies {(keyof TaskRow)[]} */ (/** @type {const} */ ([
  'id',
  'title',
  'status',
  'type',
]));

/**
 * Fields whose value must be a plain string, checked by TYPE rather than presence.
 *
 * `REQUIRED_FIELDS` above is a PRESENCE check, so `title: 42` satisfies it — the row is neither
 * nil nor empty. These are the fields the loader will otherwise drop for being the wrong shape,
 * so `validate` has to be able to say so too.
 *
 * `@satisfies {(keyof TaskRow)[]}` for the same reason the list above carries it, and it is not
 * decoration: this list drives a `for…of` that reads `t[field]`, so a typo (`'descripton'`) would
 * compile clean, lint clean, and check nothing — a guard whose failure mode is silence, which is
 * the exact anti-pattern the loader's four `else reject(...)` calls were added to close. The cast
 * makes the typo TS2322 instead.
 */
export const STRING_FIELDS = /** @satisfies {(keyof TaskRow)[]} */ (/** @type {const} */ ([
  'title',
  'agent',
  'description',
]));

/**
 * THE machine-readable error vocabulary — every `code` an exit-1 `InputError` may carry.
 *
 * It lives in the schema for the same reason the status and type vocabularies do: this is a
 * contract a consumer BRANCHES on, so it needs one authority, not a string typed by hand at
 * each throw site. `'ETWOSTOREZ'` used to compile clean.
 *
 *   ENOSTORE    no store here — the most important one, and the reason this package exists
 *   EUSAGE      you typed it wrong: a bad command name, a bad flag or value ON A NAMED COMMAND,
 *               a FLAG STANDING WHERE A COMMAND BELONGS (`diarie --json ready` — the command is
 *               unroutable there, so it is a mistake, not orientation), or a retired env var
 *               still set. ONLY a genuinely bare `diarie`, or an explicit `--help`/`--version`,
 *               escapes this and exits 0 with help.
 *   EEXIST      `init`/`migrate` refusing to touch a store that is already there
 *   ETWOSTORES  both forms of the store pair present — refusing to guess between them
 *   ELEGACY     `init` refusing to start a second store beside one at a retired name
 *   ELOSSY      `migrate` refusing to discard export data the store cannot hold
 *   EPLUGINSTORE  the walk-up landed inside an installed plugin's OWN store, and we refuse to
 *               serve someone else's backlog as yours
 *
 * Adding one is a public-contract change, and THIS PARAGRAPH USED TO UNDER-COUNT WHAT THAT
 * COSTS — it named three surfaces when there are SEVEN, which is exactly how the ungated ones
 * drift. Measured 2026-08-05, all of them:
 *
 *   1. this list AND the array below — two edits in this file, because the prose is written
 *      by hand rather than generated from the array
 *   2. the `CASES` table in `test/cli.spec.js`, which must TRIGGER the code through a spawned
 *      binary. This is the ONLY automated failure: its completeness assertion diffs the table
 *      against this array, so a code nothing proves reachable cannot be added quietly
 *   3. README's exit-code table row
 *   4. CLAUDE.md's exit-code bullet
 *   5-7. `brand/index.html`, `brand/brand-book.html` and `brand/tokens.json`, which each carry
 *      the vocabulary as PROSE — hand-editable, and gated by nothing whatsoever. diarie.dev
 *      documents this contract, so a stale list there is a false claim about the CLI with no
 *      instrument that can see it. (They are labels, not simulated terminal output; the one
 *      `<pre>` block carrying a code shows only ENOSTORE and must never be hand-edited.)
 *
 * Exit code 2 is deliberately absent: that is `ResultError` ("it ran, the answer is no"), which
 * carries no `code` because the command has already said its piece on stdout.
 */
export const VALID_ERROR_CODES = /** @type {const} */ ([
  'ENOSTORE', 'EUSAGE', 'EEXIST', 'ETWOSTORES', 'ELEGACY', 'ELOSSY', 'EPLUGINSTORE',
]);

/** @typedef {(typeof VALID_ERROR_CODES)[number]} ErrorCode */

/**
 * The store's name, and its two permitted forms — THE closed pair (decision `diarie-pos`).
 *
 * The store is a *diarium*: `diarium/` if the repo wants its register findable on a bare
 * `ls`, `.diarium/` if it wants the reading-room posture. Which one exists on disk IS the
 * choice — there is no config key, no environment variable, nothing to resolve before the
 * store can be found, and `git mv` flips it at any time because the reader accepts both.
 * **Exactly two forms, ever**; a third reopens the decision.
 *
 * Visible first: `[0]` is what `init` writes by default.
 *
 * This REPLACED a single `TRACKER_DIR` constant whose comment promised that "renaming the
 * store is a one-line change". A pair is not a constant — it is a fact resolved against the
 * filesystem — so that promise could not be kept, and the singular name was removed rather
 * than left to mean "whichever one I happened to guess". A consumer's
 * `join(root, TRACKER_DIR, 'tasks')` would have kept working on visible stores and silently
 * missed dotted ones, which is this codebase's founding defect in a new coat.
 *
 * Resolution lives in `store/root.js` (`trackerDirIn`) — never re-derive it by hand.
 */
export const TRACKER_DIRS = /** @type {const} */ (['diarium', '.diarium']);

/** @typedef {(typeof TRACKER_DIRS)[number]} TrackerDir */

/**
 * No longer the store. Never READ — but very much still checked. (`backlog/` → `.diarie/`
 * 2026-07-11 → the `diarium` pair 2026-07-28.)
 *
 * Two different jobs consume this, and calling it "detected so a reader can name the
 * migration" described only the gentler one:
 *
 * - a READER names the migration rather than reporting "no store" at a project that plainly
 *   has one (`NoStoreError.legacy`);
 * - a WRITE-PATH GUARD refuses to clobber it — `init` (`ELEGACY`), the migrate bootstrap's
 *   overwrite check, and `bd-map.js`'s refuse-to-write check. A retired name is exactly the
 *   name a not-yet-migrated project still has, so it is the case a guard most needs to know;
 *   `isAnyStoreDir` exists so no guard has to remember to ask.
 *
 * `backlog/` is deliberately NOT in this list even though it was the first name: it is an
 * ordinary directory in countless repos, so treating it as a store at runtime would refuse
 * to `init` on a false positive. The ast-grep rule still flags `backlog/` *literals in
 * code* — detecting a stale path in source and detecting a store on disk are different jobs.
 */
export const LEGACY_TRACKER_DIRS = /** @type {const} */ (['.diarie']);

/** @typedef {(typeof LEGACY_TRACKER_DIRS)[number]} LegacyTrackerDir */

/**
 * How the store is NAMED in error text — the pair in one clause, in one place.
 *
 * The deno tax, paid once: a two-name set puts an "or" into every sentence that names the
 * thing. Centralising the clause keeps it from drifting across its four consumers —
 * `store/errors.js`, `store/init.js`, `commands/migrate.js` and `flags/store.js` — and keeps
 * those files free of the literal `diarium`, which the `no-hardcoded-tracker-dir` ast-grep rule
 * flags everywhere except here.
 *
 * The list is grep-derived, not remembered. It has been wrong in both directions: it named a
 * module that does not import this (`store/root.js` resolves the pair but never has to NAME it)
 * while omitting `commands/migrate.js` and `store/errors.js`, the latter being the file that
 * actually writes most of these sentences. Re-grep before trusting it.
 */
export const TRACKER_LABEL = `${TRACKER_DIRS[0]}/ (dotted or not)`;

/**
 * Where the `tasks-<slug>.yml` files live. ROWS, not records — see `RECORD_DIRS`.
 */
export const TASKS_DIR = 'tasks';

/**
 * The store's INTERNAL layout: one content-home per type that lives as a FILE, keyed by
 * the type that lives there.
 *
 * `TRACKER_DIRS` names the store; this names what is inside it. Keyed by type because that
 * is the schema fact stated above — a `decision` lives in `decisions/<id>.md`, a `doc` in
 * `docs/<id>.md` — and keying it that way is what lets a reader report "this record claims
 * a type that does not belong in the directory it is in". `task` and `milestone` are absent
 * on purpose: they are rows inside a file, not files, which is why `TASKS_DIR` is a separate
 * constant rather than a third key here.
 *
 * These names were spelled out in three places (`init.js` twice, `list-task-files.js` once)
 * for as long as nothing read the store as a whole. `validate` growing an opinion about the
 * WHOLE store made the alternative a fourth fork of the same vocabulary, which is the thing
 * this module exists to prevent. Note the `no-hardcoded-tracker-dir` ast-grep rule does NOT
 * cover these — it guards the store's own name — so keeping them here is a convention held
 * by hand, not by a rule.
 *
 * 🚨 `docs/` is DECLARED here and created by nothing: `init` writes `tasks/` and
 * `decisions/` only. A reader must therefore treat its absence as ordinary, never as a
 * broken store.
 */
export const RECORD_DIRS = /** @type {const} */ ({ decision: 'decisions', doc: 'docs' });

/** @typedef {keyof typeof RECORD_DIRS} RecordType */

/**
 * The store name a given posture CREATES — the one sanctioned way to turn a `--dotted`
 * boolean into a store name.
 *
 * A function rather than an index, and that is the whole point. `TRACKER_DIRS[0]` is legal
 * and well-typed, so the compiler cannot tell "the default form, because I am creating one"
 * from "the visible form, because I forgot the other exists" — and the second is this
 * codebase's founding defect in a new coat: `join(root, TRACKER_DIRS[0], 'tasks')` compiles
 * green and silently misses every dotted store. Removing the old singular `TRACKER_DIR` was
 * supposed to make form-confusion a compile error; it only made *comparison* confusion one
 * (`=== '.diarie'` → TS2367). Path construction still slipped through, so the guard is the
 * `no-indexed-tracker-dir` ast-grep rule, and this is what it points people at.
 *
 * For CREATION only. To find a store that already EXISTS, ask `trackerDirIn(root)`: what is
 * on disk outranks any flag, because posture is flipped with `git mv` and never with a flag
 * (decision `diarie-pos`).
 *
 * @param {boolean} [dotted]
 * @returns {TrackerDir}
 */
export const defaultTrackerDir = (dotted) =>
  dotted ? TRACKER_DIRS[1] : TRACKER_DIRS[0];

/**
 * Types whose completion should carry stated acceptance criteria (the
 * test-ratchet). A completed item of one of these with an empty
 * `acceptance_criteria` warns — "state done-ness before marking done".
 * Under the 4-type model only `task` carries work, so only `task` ratchets;
 * label-conditional refinements (e.g. `spike` → findings) are a future
 * ADVISORY layer, never hard errors.
 */
export const IS_RATCHETING_TYPE = /** @satisfies {Record<TaskType, boolean>} */(/** @type {const} */ ({
  decision: false,
  doc: false,
  milestone: false,
  task: true,
}));

/**
 * Nullish check (a missing YAML key → `undefined`; an explicit `key: null` → `null`).
 *
 * @param {unknown} v
 * @returns {v is (undefined | null)}
 */
export const isNil = (v) => v === undefined || v === null;

/**
 * Globalize a reference to a task: a bare id takes its file's slug (`slug/id`); an
 * id that already carries a slug passes through. Idempotent, so it is always safe
 * to apply again.
 *
 * THE ONE PLACE THIS RULE LIVES. It used to exist twice — the loader had it as `nsId`,
 * `validate.js` had a behaviourally identical private `glob` — and the copies drifted:
 * and applied it to `id` and `deps` but not to `parent`, so `loadTasks` handed out
 * a half-globalized task whose `parent` (`T-0`) could never match any `id` (`slug/T-0`).
 * `validate.js` was spared only because its copy WAS applied to `parent`.
 *
 * Nothing was broken by this at the time — no reader consumed `parent`. It was a trap
 * laid for the next one. When the container rule arrived — the rule that stops an epic
 * being offered as ready work — indexing children by parent would have matched nothing,
 * excluded no epic, changed no behaviour, and passed a green suite. A latent bug that
 * only fires when someone finally trusts the data is worse than a loud one, because it
 * fires as a silent success.
 *
 * Two implementations of one id rule is what let one of them be incomplete. Keep it here,
 * keep it single, and import it.
 *
 * @param {unknown} ref   a task id or reference, bare or already `slug/id`
 * @param {string} slug   the slug of the file the reference was written in
 * @returns {GlobalId}
 */
export const nsId = (ref, slug) => /** @type {GlobalId} */ (
  String(ref).includes('/') ? String(ref) : `${slug}/${ref}`
);

/**
 * Membership tests that actually NARROW.
 *
 * `Set<Status>.has()` does not narrow — it returns a bare boolean, and it refuses a
 * `string` argument outright, which is how `commands/ready.js` ended up casting `--filter`
 * through `any` at the exact boundary the Set was supposed to be guarding. Widening the
 * Sets to `Set<string>` would lose the vocabulary; `guardedArrayIncludes` keeps both, by
 * narrowing `unknown` to the Set's own member type.
 *
 * The schema is the authority on the vocabulary; it should also be the authority on how
 * to CHECK it, or every consumer improvises — and one of them improvised with `any`.
 *
 * @param {unknown} v
 * @returns {v is Status}
 */
export const isStatus = (v) => extendedGuardedArrayIncludes(VALID_STATUSES, v);

/**
 * @param {unknown} v
 * @returns {v is TaskType}
 */
export const isTaskType = (v) => extendedGuardedArrayIncludes(VALID_TYPES, v);

/**
 * @param {unknown} v
 * @returns {v is Priority}
 */
export const isPriority = (v) => extendedGuardedArrayIncludes(VALID_PRIORITIES, v);

/**
 * Is this path segment one of the store's two CURRENT names?
 *
 * Lives here for the same reason `isStatus` does: the schema is the authority on the
 * vocabulary, so it should also be the authority on how to CHECK it, or every consumer
 * improvises — and improvised membership tests are how a guard ends up matching one form of
 * a two-form pair and silently passing the other.
 *
 * For a GUARD, use `isAnyStoreDir` instead — see the warning there.
 *
 * @param {unknown} v
 * @returns {v is TrackerDir}
 */
export const isTrackerDir = (v) => extendedGuardedArrayIncludes(TRACKER_DIRS, v);

/**
 * Is this path segment a name the store has EVER had — current pair or retired?
 *
 * THE ONE TO USE IN A GUARD, and the distinction is not pedantry. A guard is a safety net:
 * a name it does not know does not make it error, it makes it stop guarding. `bd-map.js`'s
 * refuse-to-write check used `isTrackerDir` and therefore exited 0 while overwriting a live
 * `.diarie/` store — the retired name is exactly the one a not-yet-migrated project still
 * has, so it is the case a guard most needs to catch, not least.
 *
 * The rule of thumb: ask `isTrackerDir` when you are about to USE a store (only the current
 * names are readable), ask this when you are about to HARM one.
 *
 * @param {unknown} v
 * @returns {v is TrackerDir | LegacyTrackerDir}
 */
export const isAnyStoreDir = (v) => isTrackerDir(v) || extendedGuardedArrayIncludes(LEGACY_TRACKER_DIRS, v);
