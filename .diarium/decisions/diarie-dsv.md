---
id: diarie-dsv
title: Decision records carry an inert `status: pending` — give them their own status vocabulary (recommend an ADR-style enum; reuse task statuses as fallback)
status: pending
type: decision
priority: medium
updated: '2026-07-20'
---

## Decision

**Not yet made — recorded so the choice happens on purpose, and because this record is
itself an instance of the problem it describes.** Every file in `.diarie/decisions/` carries
`status: pending`, whether the decision is settled (`diarie-reg`, `diarie-ext`, `vp-beads-etm`)
or deliberately open (`diarie-rel`, `diarie-qry`, `vp-beads-bdm`). The field is inert:
`store.js` globs only `tasks-*.yml`, so no reader and no `validate` pass ever loads decision
frontmatter — the value is read by nothing and means nothing. The uniform `pending` is a
migration artifact (`bootstrap.js` serialized each bd decision-issue's frontmatter as-is).

Recommended direction: **a decision-specific status vocabulary (option B)**, with plain reuse
of the task statuses (option A) kept as the cheaper fallback if branching the enum proves not
worth the machinery.

## The mismatch

`VALID_STATUSES` (`pending → in_progress → completed/failed/cancelled/deferred`, `lib/schema.js`)
is a _task lifecycle_. A decision record's states are ADR-shaped —
`proposed / accepted / rejected / superseded / deferred`. They do not map: a decided decision
is not "completed work", and a rejected one is not "cancelled". A single flat `VALID_STATUSES`
shared across `task` and `decision` is the root of the oddity.

## Options

* **A — reuse the task statuses.** decided → `completed`, not-yet-made → `deferred`,
  rejected → `cancelled`. Zero schema change; `VALID_STATUSES` stays one flat set. Cost: the
  semantics are a stretch, and the field keeps lying a little.
* **B — a decision-specific vocabulary (recommended).** The canonical ADR set (Nygard 2011,
  Lullabot) is `proposed / accepted / deprecated / superseded`; diarie would extend it with
  `rejected` (proposed but declined) and `deferred` (its existing "consciously postponed"). With
  `VALID_STATUSES` made type-aware — a `task` validates against the lifecycle enum, a `decision`
  against the ADR enum. Cost: `isStatus` (today one `guardedArrayIncludes` over one Set,
  `lib/schema.js`) must branch on `type`, and something must actually READ decision frontmatter to
  check it — which is `diarie-dlm`.
* **C — drop `status` from decision frontmatter entirely.** Encode decided-vs-open structurally
  (a `decided:` date present-or-absent, or keep the body convention "Not yet made"). Honest,
  since nothing reads the field — but it forfeits the at-a-glance state a lint could surface once
  decisions ARE loaded.

## Why B, with A as fallback

B is the only option that lets a decision's status carry its real state AND be checkable. It is
the natural unblocker for `diarie-dlm` (native decision-frontmatter linting): a lint that
enforces a decision status enum must first agree on what that enum is — `diarie-dlm`'s own
acceptance criteria already say "settle the decision-status vocabulary first". A is the retreat
if type-branching the enum is judged more machinery than the payoff; C is the retreat if the
conclusion is that a decision's state belongs in its prose, not a field. The prior art below
sharpens the ranking: in the ADR tradition a decision's content is immutable and its status is the
ONE field that evolves — which is the strongest reason NOT to leave that field inert (today) or
drop it (C).

## Prior art (grounding)

The canonical ADR literature settles the vocabulary this decision is choosing:

* **Michael Nygard, "Documenting Architecture Decisions" (Cognitect, 2011)** — the origin of the
  ADR format. Status is one of five sections: a decision is `proposed` until stakeholders agree,
  `accepted` once agreed, and `deprecated` or `superseded` (with a reference to its replacement)
  when a later ADR changes it. That is option B's enum, verbatim.
  [source](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions.html)
* **Lullabot's Architecture Decisions** (a 70-ADR practitioner log) — "An ADR is immutable once
  accepted ... Otherwise, only its status can change (become deprecated or superseded)." If status
  is the ONE mutable field on an otherwise-immutable record, modelling it as an inert `pending`
  (today) or dropping it (C) discards the single field the format exists to evolve — the strongest
  argument for B over C. [source](https://architecture.lullabot.com/)
* **ADR-as-event-sourcing (Shing Lyu, 2026)** — reframes a decision log as an append-only event
  stream whose "current architecture" is a replay projection: content fixed, status carries the
  lifecycle. Same immutability model, and on-thesis for a store that is "just files".
* **Supersession needs an explicit authored link** — the research corpus finds automated
  supersession detection unsolved (semantic similarity confounds relatedness with supersession), so
  Nygard's "`superseded` with a reference to its replacement" is load-bearing, not decorative. In
  diarie that pointer is a typed relation — making `superseded-by` a concrete first use case for the
  `links`/`ref` model (`diarie-ext` / `diarie-lnk`) and the open relation question (`diarie-rel`).
* **Ratification external to the generation loop** ("Transformer Mandate") — a decision should be
  ratified by an entity outside the loop that drafted it. This gives diarie's `proposed → accepted`
  transition a specific meaning: `proposed` = drafted (often agent-drafted, as diarie's own records
  are — see `diarie-aus`, the AI Usage Scale row), `accepted` = human-ratified. A distinct
  `proposed` state is the audit gate, not ceremony.

The three practitioner/research strands above are consolidated in the Basic Memory note
`engineering/patterns/architecture-decision-records-patterns-practice-and-critique`.

## Relations

* Blocks `diarie-dlm` — the decision-frontmatter lint needs the vocabulary settled before it can
  enforce a status enum.
* Its VALUE is only realized once something loads decision frontmatter (`diarie-dlm`, and the
  cross-surface id work in `diarie-xid`) — until then any decision status is unread either way.
* Localizes what was the cross-repo `vp-beads-dlf` thread (the "decision-status vocab" row in the
  vp-beads root store). diarie is standalone now, so the vocabulary decision has a home here.
* Adjacent family: `diarie-typ` (type-model edges the tooling never enforces) and `diarie-rdr`
  (loader silent-drops) are the same "the model defines something nothing checks" shape.
