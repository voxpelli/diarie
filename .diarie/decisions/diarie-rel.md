---
id: diarie-rel
title: Relation model — keep `deps`/`parent` as distinct computed keys, or unify all relations into `links`?
status: pending
type: decision
priority: medium
updated: '2026-07-20'
---

## Decision

**Not yet made — recorded so the choice happens on purpose.** Once `links` exists (`diarie-ext` /
`diarie-lnk`), diarie will have three relation mechanisms: `deps` (gates `ready`), `parent` (gates
containers), and the open `links` space (non-computed). The tempting unification is to retire `deps`
(and maybe `parent`) and express them as `links` entries — `rel: blocks`, `rel: parent` — so that
"everything is a typed link." This record holds that question open; `diarie-ext` deliberately keeps
`deps`/`parent` distinct in the meantime.

## Rationale

**The pull toward unification is real:** one relation mechanism instead of three, maximal fit with
the open-relation vision, and new relations addable by convention.

**But the founding thesis pushes back hard, and it is the deciding constraint.** diarie exists so
that "a guard that DROPS a value must also REPORT it." A computed dependency encoded as
`links: [{ rel: blocks, ref: T-0 }]` is vulnerable in a way a dedicated `deps:` key is not: a typo in
the *value* (`rel: block`, `rel: depends`) silently removes the edge from the ready-computation, and
`validate` — which already ignores unknown keys and would have no reason to reject an unknown `rel` in
an OPEN vocabulary — reports nothing. The result is a blocked task surfaced as ready with no error:
precisely the silent-mislead failure mode the whole tool is built against. A distinct `deps:` key
cannot be typo'd into invisibility; an open-`rel` link can.

So the open vocabulary that makes `links` valuable for *navigation* is in direct tension with the
safety a *computed* relation needs. They can only be reconciled by making any computed `rel` a
**closed, validated vocabulary** (a typo becomes a validation error, not a silent drop) — at which
point that subset of `links` is no longer "open," and the clean mental model ("computed relations are
their own keys; `links` is the open non-computed space") may simply be clearer than "everything is
`links`, but these particular rels have teeth."

Secondary costs: migration of every existing store (+ `diarie migrate` support); loss of the terse,
scannable `deps: [T-0]` for the most common relation; and the careful `deps`/`parent` namespacing
(the GlobalId brand, the `parent` half-globalization bug in the schema comments) would have to be
re-homed onto link resolution without regression.

## Recommendation

**Do not retire `deps` yet.** Ship `links` as the open, non-computed relation space (`diarie-ext`),
keep `deps`/`parent` as distinct computed keys, and revisit this only if a concrete need emerges after
`links` is in real use. If unification is ever pursued, computed relations MUST use a closed validated
`rel` vocabulary so a mistyped relation fails loudly rather than silently dropping a gating edge.

## Revival trigger

Reopen if, after `links` ships and is used, maintaining three relation mechanisms causes measurable
friction (e.g. users reach for `links` to express dependencies, or the parallel `deps`/`links`
resolution logic drifts). The revisit starts from the closed-vocabulary constraint above.

## Alternatives Considered

- **Unify now (retire `deps`, express as `rel: blocks`)** — declined for now: the silent-drop risk
  above is unacceptable under an open `rel` vocabulary, and the everyday relation gets more verbose.
- **Never unify** — not chosen either; the question is left open rather than foreclosed, because the
  open-relation vision is a genuine draw and a closed computed-`rel` vocabulary could reconcile it.

## Affects

- Nothing yet — `diarie-ext` keeps `deps`/`parent` distinct. If decided toward unification later:
  `lib/schema.js`, `lib/store.js` (id/dep globalization), `lib/validate.js`, the ready-walk, and a
  `diarie migrate` path.
