# SYNERGY-vp-beads

Tracking cross-project synergy with [vp-beads](https://github.com/voxpelli/claude-beads).

diarie was extracted from vp-beads (2026-07-18, `git subtree split`). vp-beads consumes diarie —
its skills shell out to the `diarie` binary and read the store directly, and it carries `diarie/`
as a vendored subtree snapshot until diarie publishes. Relationship: `consumer` (the inverse of
vp-beads's `dependency`).

## Shared Patterns

- **The store contract** (2026-07-18) — diarie owns the store schema, the `--root` /
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
  no `--ignore-pattern` for the store and no `check:md-decisions` split (decision `diarie-tbl` — one
  pass, no exclusions). Two copies with no shared package will drift; converge on a shared
  `@voxpelli/remark-config` if a third consumer appears.
  Status: drifting · Last verified: 2026-07-18

## Divergences

- **The store is now the `diarium` pair — vp-beads reads the old name** (2026-07-28, decision
  `diarie-pos`). diarie's store is `diarium/` or `.diarium/`, chosen by which directory exists;
  `.diarie/` is legacy, detected only so a reader can name the `git mv`. Three breaks for the
  consumer side, all deliberate and all loud:
  1. **`TRACKER_DIR` is GONE from `diarie/schema`.** Not aliased — removed. A singular constant
     cannot answer "which of two forms is on disk", and leaving it as `'diarium'` would have kept
     `join(root, TRACKER_DIR, 'tasks')` working on visible stores while silently missing dotted
     ones. Migration: `TRACKER_DIRS` (the pair) + **`trackerDirIn(root)`** (resolves which form is
     there, throws `ETWOSTORES` on both), or `TRACKER_LABEL` for error prose.
  2. **`TASKS_ROOT` → `DIARIUM_ROOT`.** In every command that resolves a store from the
     environment (`ready` / `stats` / `validate` / `init`), a stale `TASKS_ROOT` is a hard
     `EUSAGE` rather than a silent skip — skipping it would drop an explicit root and fall
     through to the upward walk, onto a different store. `migrate` is the exception and always
     was: it reads no environment at all, only `--root` or cwd, so that a forgotten flag cannot
     reach across the filesystem and clobber a tracker somewhere else.
  3. **New exit codes**: `ETWOSTORES` and `ELEGACY` join `ENOSTORE`/`EUSAGE`/`EEXIST`. Any skill
     that branches on `code` should learn them; `ELEGACY` in particular is what stops a hook from
     answering `ENOSTORE` by running `init` and creating a second backlog.

  **Also stale on the vp-beads side: its copy of `no-hardcoded-tracker-dir.yml`.** That rule
  deliberately lives on both sides (its own header says so — ast-grep sgconfig has no `extends`).
  diarie's copy learned the pair today; the plugin's copy still flags only `.diarie`/`backlog/`, so
  it under-guards exactly where the rule matters most — in guard code, where a stale literal does
  not error, it silently stops guarding.
  Status: **breaking, unreconciled** · Last verified: 2026-07-28

## Extraction Candidates

*No entries yet.*

## They Have / We Don't

- **bd→diarie adoption skills** (2026-07-18) — vp-beads owns the adoption pair (`migrate-tracker` +
  `deintegrate-beads`), routed to the vp-skills monorepo (`plugins/diarie-adopt`) to decouple it
  from diarie's publish timeline. If diarie publishes and wants to own its full adoption story,
  these could move here — blocked on the `bd-map` coupling (`lib/migrate/bd-map.js`).
  Priority: deferred · Effort: moderate
