---
id: diarie-qry
title: Should diarie provide a query/search surface over the store, or leave it to grep/yq?
status: pending
type: decision
priority: low
updated: '2026-07-18'
---

## Decision

**Not yet made — deferred, recorded so the choice happens on purpose.** The trigger was a plain
`grep .diarie/tasks/*.yml` for a keyword during a 2026-07-18 session: it works, but a task is a
multi-line YAML *record*, and line-oriented grep loses record identity — a hit on a `title:` line
does not carry the row's `id` / `status` / `type`, and a hit inside a `description:` block is
orphaned from its header. So "just grep the store" underserves the store's structure. Whether
diarie should close that gap in the CLI is the open question.

## Rationale

diarie's reads earn their place by COMPUTING something grep cannot: `ready` is a pure function of
the dependency graph (type-gate + dep-completion + container-exclusion); `stats` aggregates. A
keyword search that only "greps and returns records" has a thinner justification — but the
record-identity papercut above is real, and there is currently NO way to enumerate rows at all
(`ready` is dep-gated, `stats` only counts). Three shapes, cheapest-first:

- **(a) Document the `yq` recipe.** The store is plain YAML; `yq '.tasks[] | select(.title |
  test("remark"))' .diarie/tasks/*.yml` returns whole records. Zero new code, maximally
  substrate-not-opinion ("your editor + standard tools"). Cost: users must know yq, and multi-file
  globbing is a little fiddly.
- **(b) A minimal `diarie list` reader.** A raw, NON-dep-gated record lister with `--status` /
  `--type` / `--label` / `--match <regex>` filters and `--json`; "search" is just `--match`. Fills
  the genuinely-missing "enumerate rows" primitive, fits the four-part command shape, and echoes
  `diarie-spa`'s "structure by query, not by warning" lean.
- **(c) A bespoke `diarie search`.** Narrowest, but subsumed by (b) + `--match`.

**Recommendation: prefer (a) or (b) over a search engine.** Build (b) only if the "no way to list
rows" gap is felt in practice; otherwise (a) is the on-brand answer. Do NOT build a bespoke search.

## Alternatives Considered

- **A dedicated `diarie search` command** — declined as the first move; it is (b) with a narrower
  surface, and a `list --match` reader is the more general primitive.
- **Do nothing, keep grep** — viable, but the record-identity papercut is the reason this is
  recorded rather than dropped: revisit if store-grep friction recurs.

## Affects

- Possible new `lib/commands/list.js` (a four-part reader) or a README / `diarie docs` `yq`-recipe
  section — not built; this record only frames the choice.
- Substrate-not-opinion: every command added is surface area the "just files" thesis must justify.
