---
id: diarie-ids
title: Are record ids numbered? — no; filename-identity for decisions and docs, allocation owned by diarie-reg
status: pending
type: decision
priority: medium
updated: '2026-07-28'
---

## Decision

**Decided 2026-07-28, scoped to decision and doc files:** a decision's or doc's id is a slug in the
store's convention, and **the filename is the identity** — `<TRACKER_DIR>/decisions/<id>.md`,
`<TRACKER_DIR>/docs/<id>.md` — with no sequence number anywhere in it. Task rows are explicitly
*out of scope*: they live inside `tasks-<slug>.yml`, carry bare ids globalized to `slug/id` by
`nsId()`, and their identity model is the file-plus-row model the schema already defines. And id
*allocation* — the diarienummer act itself — is owned by [diarie-reg](./diarie-reg.md), which this
record defers to and complements, never competes with.

## Rationale

The diarium metaphor pulls toward sequence — the classic diarienummer is sequential — but the
substrate differs: a myndighet has one registrar stamping one sequence; a git-backed store has
parallel branches and no central counter. [diarie-reg](./diarie-reg.md) already draws the
conclusion for allocation: ids must be "short, consistent with the id convention, and
collision-resistant across git branches without central coordination," with auto-increment banned
outright. In diarie's language the id *is* the diarienummer — "every task has its id — its
diarienummer" (BRAND.md) — so nothing of the diarienummer is dropped here; what is refused is only
its *sequential form*, which required the central registrar git does not have.

What this record adds on top of diarie-reg is the failure-mode argument for why
**filename-identity is the right shape for the prose types**, sourced from the numbered world's
own history:

- **Two branches, same slug** → same filename → an add/add merge conflict. Loud, and *correct*:
  either both branches meant the same record and someone merges the content, or they meant
  different records and one renames. The conflict is the system working.
- **Two branches, same sequence number** → different filenames → no conflict. Two records silently
  share an identity. adr-tools issue №102 records exactly this — two parallel PRs each minting
  "ADR 6," "two ADRs with different names but the same number" — and Rails switched migrations to
  UTC timestamps in 2.1 (commit c00de99) to "as good as eliminate the problem of multiple
  migrations getting the same version assigned in different branches."

Slugs turn identity collisions into loud conflicts; sequences turn them into silent duplicates.
For task *rows* the equivalent guarantee comes not from filenames but from diarie-reg's minting
scheme plus the store's one-owner-per-slug atomic-write invariant — different mechanism, same
refusal of the central counter.

## Alternatives Considered

- **Monotonic numbers** — the silent-duplicate failure above, plus a counter file that is itself a
  merge hazard. Already banned by [diarie-reg](./diarie-reg.md); this record supplies the sourced
  prior art for the ban.
- **UTC timestamps** (the Rails fix) — right for migrations, where execution *order* is the point
  and names carry no meaning. Wrong for decisions and docs, where names carry the meaning and
  chronology is git's job — the commit is the INKOM stamp.
- **ULID/KSUID** — collision-proof and meaningless; ids become strings no human types, no agent
  gains from, and no one speaks aloud.
- **Date-prefixed slugs** — verbose, and the date goes stale on long-lived branches, embedding a
  small lie in the identity.

## Affects

- Nothing ships — this record affirms the existing shape ("decision/doc ids are their filenames,"
  per diarie-reg's own analysis) and files the prior art where `diarie register`'s id-scheme work
  (task `diarie-rgc`) can cite it.
- Renaming a record is renaming a file; in-store links are relative and move with it.
- No global ordering exists in ids, by design; sorted views come from `updated` frontmatter or git
  history.

## Revival triggers

- Cross-repo citation — the diarienummer as *external* reference — becomes a real need. The answer
  then is a display-number layer minted linearly on the main branch at merge time: numbering as
  presentation, never as identity.
- diarie-reg's `register` implementation surfaces a constraint that filename-identity for
  decisions/docs cannot satisfy — reconcile there first, here second.

## Revisions

- 2026-07-28 — filed. Two notes on landing: the store directory this record names is now the
  `diarium` pair ([diarie-pos](./diarie-pos.md)), so the identity paths read
  `<store>/decisions/<id>.md`; and the `docs/` half is **prescriptive, not descriptive** — `init`
  has never created `docs/` and nothing reads it. Whether `doc` survives at all is task
  `diarie-typ`'s prune-or-build call, which this record does not pre-empt. Filename-identity is
  what `docs/` gets *if* it is built.
- 2026-07-28 — rescoped against the repo: filename-identity narrowed to decisions and docs (task
  rows follow the schema's file-plus-row model with `nsId()` globalization); allocation deferred
  to [diarie-reg](./diarie-reg.md), which had already decided the id-scheme rationale and the
  auto-increment ban; the diarienummer framing corrected — the id *is* the diarienummer, and only
  its sequential form is refused. Frontmatter and id matched to store conventions (`diarie-ids`,
  provisional mint). Folding this record into diarie-reg as an addendum remains an open option.
- 2026-07-28 — drafted, promoting an out-of-scope flag from the store-naming records to its own
  decision, after prior art (adr-tools №102; Rails c00de99) confirmed the collision that
  non-sequential ids sidestep.
