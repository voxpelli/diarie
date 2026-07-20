---
id: diarie-ext
title: User-extensible task metadata — optional `files` and `links` (open web-linking relations)
status: pending
type: decision
priority: medium
updated: '2026-07-20'
---

## Decision

Add two OPTIONAL, purely-informational metadata fields to `task` rows, establishing a small
extensible-metadata layer on the schema:

- **`files`** — a list of path strings the task directly affects.
- **`links`** — a list of typed relations on the Web Linking model (RFC 8288 / IANA link
  relations): each entry carries a `rel` and targets either another entity in the store or an
  external URL.

```yaml
    files:
      - lib/schema.js
      - lib/validate.js
    links:
      - rel: related
        ref: diarie-reg          # internal: any entity id (task/decision/doc/milestone)
      - rel: alternate
        href: https://github.com/voxpelli/foo   # external URL
```

Both are **non-gating**: nothing in the ready-walk computes on them. They are metadata a reader
filters and navigates by, and a stale value can never corrupt what is workable. For now, `deps` and
`parent` remain the two first-class COMPUTED relations, and `links` is the OPEN, non-computed
relation space for everything else (`related`, `alternate`, `see-also`, external references).
Whether the computed relations should eventually fold INTO `links` is a real, separate question —
recorded as decision `diarie-rel`, not settled here.

## Rationale

- **Data quality over lossy prose.** A file path or a cross-reference buried in a title/description
  is unqueryable. As structured fields they support `diarie list --file <path>` and `--rel
  <relation>` (task `diarie-lst`) and, for `files`, the file-contention partitioning diarie's own
  CLAUDE.md mandates for parallel work — which git cannot answer for PENDING work.
- **Standards over products (a founding tenet).** `links` reuses the web's link-relation model
  (`rel`/`href`, RFC 8288) rather than inventing a bespoke reference vocabulary. `rel` is an OPEN set
  (IANA relations + custom) — the tracker does not own your relation types. That openness is what
  makes the system user-extensible rather than opinionated.
- **Substrate-not-opinion.** Both are additive, optional, and parallel to the existing `labels`/`deps`
  shape. They add data surface, not workflow opinion. `validate` already ignores unknown keys
  (`RawTask` is `Record<string, unknown>`), so the fields are non-breaking on older readers.

## Validation (shape only; the integrity gate, never the filesystem or network)

- `files`: a list of strings. **NOT existence-checked** — a task routinely names a file it will
  CREATE (`diarie-rgc` → `lib/commands/register.js` does not exist yet). Checking the working tree
  would flag every create-task as broken.
- `links`: each entry has a non-empty `rel` (string; OPEN vocabulary, not a closed enum) and exactly
  ONE target — an internal ref OR an external `href`. `href` is shape-checked as a URI, **never
  fetched**. An internal ref IS resolved against the store's id set (the unified diarienummer
  authority from `diarie-xid`): a dangling internal link is a reported broken reference, the way
  `deps` already error on dangling ids and remark-validate-links catches broken markdown links.

## Open detail to settle at implementation

The motivating example used `task: diarie-reg`, but `diarie-reg` is a *decision* — so the
internal-target key must be **entity-generic**, not `task:`. Recommend `ref:` (points at any entity
id), resolved via the unified id authority. Confirm the key (`ref:` vs `to:` vs `id:`) when building.

## Alternatives Considered

- **Keep paths/refs in title/description prose** — declined: lossy and unqueryable (the motivating
  complaint).
- **Overload `labels` (`file:...`, `related:...`)** — declined: labels are categorical framing ("how
  to think about it"); paths and typed relations are structured data. `rel`+`href` shoehorned into a
  flat string is a poor fit.
- **A closed, diarie-defined relation enum for `links`** — declined: it violates the open-relation
  spirit; `rel` stays open (IANA + custom). (A closed vocabulary IS, however, the likely price of
  ever making a relation *computed* — see `diarie-rel`.)

## Affects

- `lib/schema.js` gains optional `files?: string[]` and `links?: Link[]` on `TaskRow` (+ a `Link`
  typedef); `lib/validate.js` gains shape checks and internal-ref resolution — tasks `diarie-fil`,
  `diarie-lnk`.
- `links` internal-ref resolution consumes the unified diarienummer authority (`diarie-xid`) — so
  `diarie-lnk` depends on `diarie-xid`.
- `diarie list` (`diarie-lst`) gains `--file` and `--rel` filters.
- README / CLAUDE.md schema docs updated when the fields ship, not before.
