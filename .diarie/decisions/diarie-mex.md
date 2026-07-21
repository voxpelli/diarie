---
id: diarie-mex
title: How does `diarie-adopt` get bd's `TYPE_MAP`? — keep the dead vocabulary OUT of diarie's public `exports` (recommend vendor or a separate package; a narrow subpath as fallback)
status: pending
type: decision
priority: low
updated: '2026-07-21'
---

## Decision

**Not yet made — deliberately gated, and recorded so the choice happens on purpose instead of by
whoever first hits the import error.** The sibling package `diarie-adopt` (in vp-skills, decision
`vp-beads-cst`) needs diarie's bd→schema maps to migrate a repo off beads. diarie's `exports` map
does not expose them, so the import fails against the published package — a real cross-repo contract
that, until this record, was traced ONLY in the other repo (vp-skills row `vp-beads-dad`).

Two separable questions hide inside this one:

1. **An internal refactor worth doing on its own merits:** extract the three maps
   (`TYPE_MAP` / `STATUS_MAP` / `PRIORITY_MAP`) out of the disposable spike `bd-map.js` into a small,
   side-effect-free `lib/migrate/bd-vocab.js`, and re-point the shipped migrator `bootstrap.js` at it.
   This de-couples a DURABLE consumer from a file the codebase openly calls throwaway — independent of
   anything `diarie-adopt` needs.
2. **The actual cross-repo question:** should that vocabulary become part of diarie's stable public
   surface at all? **Recommended: no.** Have `diarie-adopt` vendor a copy (option C), or split a
   `diarie-migrate-bd` package (option D) if a second consumer ever appears. A dead competitor's issue
   taxonomy is migration-domain knowledge that belongs to the migrator, not to a general-purpose
   tracker's forever-API.

**Do not resolve before `diarie-adopt` actually needs it** (`vp-beads-dad` landing is the revival
trigger) — and, per `vp-beads-bdm`, do not use this record to decide the migrator's fate while the
siblings still depend on it.

## The problem

diarie's `exports` lists only `.` and `./schema` (`lib/index.js` re-exports nothing from `migrate/`).
Node's exports resolution blocks any deep import not listed, so `import 'diarie/lib/migrate/bd-map.js'`
throws `ERR_PACKAGE_PATH_NOT_EXPORTED` against the published package — even though the file ships in the
tarball (`files` includes `lib/**/*.js`). The maps are reachable in-repo and unreachable to consumers.

The failure mode this record exists to prevent is diarie's founding one: an untraced consumer contract
that lives only in the OTHER repo is exactly the silent dependency this tool is built against. If
`bd-map.js` is renamed, moved, or its map shape changed, `diarie-adopt` breaks — and that breakage is
invisible from diarie's own store and tests.

One sharpening fact, verified against source rather than an easy summary: `bd-map.js` is a self-declared
read-only *spike* ("its one-time job being done", "ships untested by design"). But its three maps are
NOT orphaned — the *shipped* migrator behind `diarie migrate`, `bootstrap.js`, imports them as the
single source of truth. Only `projectRecords` is the `@planned` / knip-flagged export with no caller.
So exposing the *file* wholesale would publish the disposable projector and its CLI as semver-committed
API; only the frozen maps are ever wanted.

## Options

- **A — a `./migrate/*` wildcard subpath.** Rejected: `*` matches greedily, so
  `"./migrate/*": "./lib/migrate/*.js"` also publishes `bootstrap.js` (the full migrator) and any future
  file dropped in `migrate/` as public, semver-committed API.
- **B — a pinned `./migrate/bd-map` subpath** mirroring the `./schema` entry. Additive (a minor bump),
  and mechanically simple. Cost: it publishes the whole disposable spike — `projectRecords`,
  `parseBdExport`, the CLI block — and importing it transitively loads `js-yaml` and `store.js`.
  Disfavored: it exports far more than the maps.
- **B′ — extract the maps, export only those.** Split the three maps into a side-effect-free
  `lib/migrate/bd-vocab.js`, re-point `bootstrap.js` at it, and export `./migrate/bd-vocab`. The
  narrowest subpath, with no transitive load and the projector left unexported. Its internal half (the
  extraction) is worth doing regardless of the export; its external half (exposing the module) is still
  the question option C answers "no" to.
- **C — `diarie-adopt` vendors a copy (recommended).** bd's writes are dead and its archive frozen, so
  the maps do not change — vendoring's one real hazard, silent drift from a moving source, is
  structurally near-zero here. A tiny, frozen, single-consumer table copied where it is used is the
  textbook safe-to-vendor case. If the copy is taken from diarie's source rather than re-typed, a CI
  assert-equal guard (the `go mod vendor && git diff --exit-code` pattern) makes the already-tiny drift
  risk provably zero.
- **D — a separate `diarie-migrate-bd` package.** Cleanly quarantines the dead vocabulary in a package
  that can be abandoned when beads is fully forgotten. But a whole versioned package for a frozen
  five-entry map is over-modularization for a solo maintainer with one consumer — reach for it only if a
  second consumer appears or npm-level "migrate off bd" discoverability is wanted.

## Why keep it out of the public surface

The runtime library should ship the migration *mechanism*; a specific competitor's *vocabulary* should
not enter its permanent API. Against diarie's tenets, a subpath export is the only option that
*violates* two of them: lock-in resistance (a semver-frozen entrypoint carrying a dead competitor's
nouns, un-removable without a breaking change) and simplicity / single-purpose (the heaviest possible
module boundary where a copied file would do). This is also the concrete resolution of the tension
`vp-beads-bdm` left standing — "bd's vocabulary in diarie's public surface forever" — by declining to
put it there.

## Prior art (grounding)

The pattern that migration/legacy vocabulary ships SEPARATE from the runtime library is near-unanimous:

- **jscodeshift** — transforms are external modules, never bundled into the framework package.
- **`@next/codemod`** — upgrade codemods live in a separate package, explicitly to keep the core lean
  and out of the production runtime.
- **Rails / ActiveRecord** — migrations live in the app, not in the ORM's public API; the ORM ships the
  migration *engine*, not any app's migration vocabulary.
- **Go vendoring** — consumers vendor a self-contained copy, kept honest by a `go mod vendor` +
  `git diff --exit-code` verify job. This is the drift-neutralizer option C points at.

(The four above were surfaced via DeepWiki and general knowledge; no citable public URL is asserted for
them — they are named as precedents, grounded in the Basic Memory note
`engineering/small-module-philosophy-unix-composability-applied-to-npm` and, on the "does admitting an
export make it public API" question, `engineering/tooling/knip-unused-export-management`.)

The cross-repo dimension is settled by the ADR literature: Martin Fowler notes a decision log stored in
a single product repository "won't work for ADRs that cover a broader ecosystem than a single code
base"; Michael Nygard's original format makes supersession an *authored* pointer with an explicit
reference, not something inferred later
([source](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions.html)). The research
strands on cross-repo tracing and unsolved supersession-detection are consolidated in
`engineering/patterns/architecture-decision-records-patterns-practice-and-critique`, and the
provider/consumer-boundary "do NOT do X yet" handoff precedent in
`engineering/patterns/accidental-correctness-via-upstream-invariant-and-content-based-migration-triggers`.

## Relations

- **Provider-canonical, with a consumer stub.** This record is canonical: diarie owns `exports`, so it
  is the upstream that *defines* the contract; vp-skills' `vp-beads-dad` is the consumer side and should
  name `diarie-mex` back. Both sides cite the other's id verbatim — the id is the join key, because
  prose descriptions rot and ids do not.
- **The link cannot be recovered by machine.** Cross-repo and supersession detection is an open problem;
  nothing in either repo observes the other. So the link is honest only because it is authored on both
  sides, carries an owner (this checkout's maintainer), and names a revival trigger: `vp-beads-dad`
  landing, or `diarie-adopt` first needing the import. A dropped cross-repo link does not degrade
  gracefully — it vanishes; the named trigger is its only revival path.
- **Pressures `diarie-rel`.** This is the first real case that forces the relation-model question to
  decide whether a relation's target may be a *foreign-store* id (`vp-beads-dad` lives in another
  store). It should not be improvised inside this record.
- **First concrete consumer of `diarie-ext` / `diarie-lnk`.** A cross-repo pointer is precisely a typed
  link to something outside this record — the extensible-links surface those rows contemplate.
- **Reinforces `diarie-dsv`.** Status and supersession-link are coupled in the ADR tradition; the same
  "a relation must be an authored pointer" finding grounds both.
- **Relates to `vp-beads-bdm`.** Same `lib/migrate/` surface, a different question: `vp-beads-bdm` asks
  whether diarie carries a bd migrator at all; this asks how a consumer imports its maps. Neither
  decides the other.
