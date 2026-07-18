# SYNERGY-vp-beads

Tracking cross-project synergy with [vp-beads](https://github.com/voxpelli/claude-beads).

diarie was extracted from vp-beads (2026-07-18, `git subtree split`). vp-beads consumes diarie —
its skills shell out to the `diarie` binary and read the `.diarie/` store, and it carries `diarie/`
as a vendored subtree snapshot until diarie publishes. Relationship: `consumer` (the inverse of
vp-beads's `dependency`).

## Shared Patterns

- **The `.diarie/` store contract** (2026-07-18) — diarie owns the store schema, the `--root` /
  nearest-wins resolution, and the `ENOSTORE` "a missing store is an error, not an empty backlog"
  contract (`lib/schema.js`); vp-beads's skills consume them. Any change to `VALID_TYPES` /
  `VALID_STATUSES` or the exit-code vocabulary must keep vp-beads's skills speaking the current CLI.
  Status: aligned · Last verified: 2026-07-18
- **The workspace owns its gates; the root delegates** (2026-07-18) — the npm-workspace
  gate-delegation shape diarie's extraction proved (a workspace's own `check:*` travel the subtree
  split) is the pattern the vp-skills monorepo generalises to N plugin-workspaces. Keep aligned.
  Status: aligned · Last verified: 2026-07-18
- **remark `check:md` markdown-lint config** (2026-07-18) — the `remarkConfig` block (frontmatter +
  gfm + lint-recommended/consistent + validate-links + list-marker `-`) was copied verbatim from
  vp-beads when `check:md` was re-added after the extraction, but diarie simplified the invocation:
  no `--ignore-pattern .diarie/` and no `check:md-decisions` split (decision `diarie-tbl` — one
  pass, no exclusions). Two copies with no shared package will drift; converge on a shared
  `@voxpelli/remark-config` if a third consumer appears.
  Status: drifting · Last verified: 2026-07-18

## Divergences

_No entries yet._

## Extraction Candidates

_No entries yet._

## They Have / We Don't

- **bd→diarie adoption skills** (2026-07-18) — vp-beads owns the adoption pair (`migrate-tracker` +
  `deintegrate-beads`), routed to the vp-skills monorepo (`plugins/diarie-adopt`) to decouple it
  from diarie's publish timeline. If diarie publishes and wants to own its full adoption story,
  these could move here — blocked on the `bd-map` coupling (`lib/migrate/bd-map.js`).
  Priority: deferred · Effort: moderate
