# CLAUDE.md — diarie

`diarie` is a flat-YAML task tracker that is **just files**: no daemon, no database, no git hooks.
The CLI is a *reader* over YAML your editor writes. It is a **library-with-a-bin** — published to npm
with both a `bin` (`diarie`) and importable exports (`import { computeReady } from 'diarie'`, plus a
`diarie/schema` subpath).

## The founding thesis (read this first)

diarie exists to fix one class of bug: **a tracker that cannot find its store must never be
indistinguishable from one reporting an empty backlog.** The old readers printed `{"ready": []}` to
stdout and whispered their only complaint to stderr (which callers pipe to `/dev/null`). So:

- **Anything a caller must not miss goes to stdout and shows up in the exit code. Nothing important is
  whispered.** (`cli.js`)
- **A guard that DROPS a value must also REPORT it, naming the consequence.** A silent no-op inside a
  gate is the bug this whole tool is built against — do not add one.

## Commands / the gate

The gate topology follows the **npm/Node convention** — `npm test` is the first-class "run everything"
verb:

- **`npm test`** — the FULL gate: `run-s check test:*` (all linting/checks, then all tests). If it
  passes, everything passes. This is what you run before declaring work done.
- `npm run check` — **linting/checks ONLY** (`run-p check:*`: lint, tsc, type-coverage, knip,
  installed-check, ast-grep, ast-grep-test, tasks). Does NOT run tests.
- `npm run test-ci` / `npm run test:node` — tests only (`node --test`).
- `npm run build` — emit `.d.ts` via `declaration.tsconfig.json` (also runs on `prepack`).

🚨 **Do NOT re-add a `check:test` script.** Tests deliberately do not live inside `check`: CI runs them
via the dedicated `nodejs.yml`/`test-ci` job, and `npm test` is the local full gate. `check:test` once
existed *because* `run-p check:*` doesn't match `test`, and removing it silently dropped tests from the
gate — that trap is closed now; don't reopen it. If you want the complete gate, run `npm test`.

## Architecture

- **`lib/schema.js` is THE AUTHORITY.** `VALID_TYPES`, `VALID_STATUSES`, `VALID_PRIORITIES`,
  `REQUIRED_FIELDS`, and `TRACKER_DIR` (`.diarie`) live here; every reader/validator/migrator derives
  its vocabulary from it — never fork it. The `.diarie` path segment lives ONLY here; an ast-grep rule
  (`no-hardcoded-tracker-dir`) bans hardcoding it anywhere else.
- **Commands are FOUR parts** (peowly-commands shape): `run()` holds no logic → `setupCommand` parses →
  **`doTheWork` RETURNS DATA and never prints** → **`formatWorkResult` is the only writer**. `doTheWork`
  is exported so the work is assertable in-process (no spawn, no stdout capture). Subcommands: `init`,
  `ready`, `stats`, `validate`, `migrate`. **`migrate` is deliberately NOT four-part** — don't convert it.
- **Flags live in `lib/flags/`** groups (`output`, `store`, `filter`, `staleness` + a barrel). Note the
  load-bearing asymmetry: `ready` resolves the store BEFORE validating `--filter`; `stats` validates
  first — this keeps `{code: ENOSTORE}` winning a double fault. Don't "tidy" it.

## The store + the 4 types

- `.diarie/tasks/tasks-<slug>.yml` holds **`task` and `milestone`** rows. `.diarie/decisions/<id>.md`
  and `.diarie/docs/<id>.md` hold **`decision`/`doc`** as frontmatter + prose body (only the loader's
  `tasks-*.yml` glob feeds the ready computation, so records are naturally never surfaced as work).
- **4 exclusive types**: `task` (work) / `doc` (reference) / `decision` (record) / `milestone` (marker).
  bd's other framings (`bug`/`feature`/`chore`/`story`/`spike`) ride in `labels:`; an epic is
  `task` + `parent:` (or an `epic` label). A type answers "what kind of thing", a label "how to think
  about it".
- **Ready rule** (the only computation that gates work): READY iff `type === 'task'`, `status ===
  'pending'`, every dep is `completed`, AND it is not a container (a task with open children or an
  `epic` label is the sum of its children, never work itself). Non-task types never appear in
  ready/blocked/needsAttention and never block.
- **Writers mutate the YAML directly (plain Edit/Write). There is deliberately NO CRUD helper** — the
  store is a substrate, not a product with an opinion about how you change it.
- **Atomic-write contract**: solo, single-host, no concurrent writers to the same `tasks-<slug>.yml`.
  Anything that fans work out in parallel must partition by file (one owner per slug).

## Exit codes (load-bearing — a machine consumer branches on these)

- `0` — success; the answer is on stdout.
- `1` — `InputError` ("you got it wrong"). Under `--json`, emitted as JSON on **stdout** with a `code`:
  **`ENOSTORE`** (no store here — the most important one), **`EUSAGE`** (bad command/flag),
  **`EEXIST`** (`init` refusing an existing store).
- `2` — `ResultError` ("it ran; the answer is no": invalid store, `--strict`). **NOTHING ELSE MAY USE
  2** — it's reserved so CI can tell a dependency cycle from a typo. Only `lib/utils/exit.js` writes it.

## Conventions & gotchas

- **ESM only**, JSDoc types (`tsc` checks, never compiles), **neostandard** via
  `@voxpelli/eslint-config` (semicolons on). Prefer `unknown` + type guards over `any`.
- **`.gitignore` is load-bearing for lint scope.** `check:ast-grep` is a bare `ast-grep scan` (no path
  args) bounded by `.gitignore`, so adding a broad ignore entry SILENTLY shrinks lint coverage with
  nothing going red. Treat every `.gitignore` line as a lint-scope decision. (See `sgconfig.yml`.)
- **8 ast-grep rules** in `.ast-grep/rules/` guard structural invariants (no hardcoded tracker dir, no
  unsanctioned `exit(2)`, no CommonJS `require`, no JSDoc `any`/`object` typedef, no computed exit code,
  no identifier-shadow call, no identical test titles). Each is paired with a rule-test.
- **Generated `.d.ts`** (`lib/**/*.d.ts`) are gitignored build artifacts, packed via `files`/`prepack`,
  and eslint-ignored — but a hand-written ambient `*-types.d.ts` stays linted and committed.
- No markdown gate here (no remark/`check:md`), so this file and decision `.md` are unlinted —
  proofread by hand.

## Guardrails

- Use ESM syntax only. Keep changes minimal and consistent with the surrounding file's style.
- Add tests for new behaviour (`test/*.spec.js`, `node:test`); validate with `npm test` before finishing.
- This repo tracks its own work in `.diarie/` — say "record a task" / "add a row", never "file a bead".
- `private: true` and the npm name gate stay until the maintainer lifts them; never `npm publish` or
  push without an explicit, in-the-moment go-ahead.
