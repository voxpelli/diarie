# CLAUDE.md — diarie

`diarie` is a flat-YAML task tracker that is **just files**: no daemon, no database, no git hooks.
The CLI is a _reader_ over YAML your editor writes. It is a **library-with-a-bin** — published to npm
with both a `bin` (`diarie`) and importable exports (`import { computeReady } from 'diarie'`, plus a
`diarie/schema` subpath).

## The founding thesis (read this first)

diarie exists to fix one class of bug: **a tracker that cannot find its store must never be
indistinguishable from one reporting an empty backlog.** The old readers printed `{"ready": []}` to
stdout and whispered their only complaint to stderr (which callers pipe to `/dev/null`). So:

* **Anything a caller must not miss goes to stdout and shows up in the exit code. Nothing important is
  whispered.** (`cli.js`)
* **A guard that DROPS a value must also REPORT it, naming the consequence.** A silent no-op inside a
  gate is the bug this whole tool is built against — do not add one.

## Commands / the gate

The gate topology follows the **npm/Node convention** — `npm test` is the first-class "run everything"
verb:

* **`npm test`** — the FULL gate: `run-s check test:*` (all linting/checks, then all tests). If it
  passes, everything passes. This is what you run before declaring work done.
* `npm run check` — **linting/checks ONLY** (`run-p check:*`: lint, tsc, type-coverage, knip,
  installed-check, md, ast-grep, ast-grep-test, tasks). Does NOT run tests.
* `npm run test-ci` / `npm run test:node` — tests only (`node --test`).
* `npm run build` — emit `.d.ts` via `declaration.tsconfig.json` (also runs on `prepack`).
* `npm run serve` — live-reload preview of the `brand/` HTML pages (`index.html` = diarie.dev) at
  `localhost:${PORT:-3334}` via `@domstack/sync`. Dev-only; `brand/` is not in the package `files`.
* **Brand tooling (`brand:*`) is maintainer/CI-run and NEVER in the gate.** `brand:build` = `run-s
  brand:copy brand:stamp brand:favicon` writes the deployable site into the **gitignored `brand-dist/`**
  (never source `brand/`, whose committed stamp is the designer's bespoke artifact). `brand:stamp`
  (`update-stamp.js`, opentype.js) outlines the INKOM stamp; `brand:favicon` (`generate-favicons.js`,
  `@voxpelli/generate-favicon`) renders `apple-touch-icon.png` from the full mark (flattening its CSS
  `var()` first — rasterizers don't resolve custom properties). `brand:check`
  (`scripts/check-brand-assets.js`) asserts referenced deploy assets exist; it runs post-build in
  `.github/workflows/pages.yml` (GitHub Pages, `deploy-pages@v5`), **not** in `npm test` (the local gate
  never builds `brand-dist/`). A mutating generator must never join `check:*`/`test:*`. If the build
  ever outgrows plain-Node copy+stamp+favicon, adopt domstack (already the `serve` tool) rather than
  hand-rolling more. Consequence: **no gate can catch a false claim in `brand/`** (only `check:md`
  reaches its `.md`), and diarie.dev documents the CLI contract — so grep `brand/` by hand on any
  CLI-surface change, and `npm run serve` to read what you touched.

🚨 **Every CLI example on a brand surface must be VERBATIM output — it has been wrong twice.**
diarie.dev's flagship `ENOSTORE` example printed the _searched-upward_ wording (`… found …`) for a
command that passes `--root`, which is explicitly not a search; `lib/store/errors.js` refuses that exact
wording in a comment ("reporting 'searched upward' when we did not is its own small lie"), so the page
told the lie the code declines to tell. `README.md` carried the same spurious "found". Generate
examples by running the real binary against a throwaway store (`node cli.js ready --root <tmp>`), paste
the bytes, and diff the tag-stripped `<pre>` text against saved stdout — never hand-edit, and never
truncate with `…`. These mocks are the CLI contract's documentation surface: a paraphrase there is a
false claim about the contract, and no gate will catch it.

🚨 **Do NOT re-add a `check:test` script.** Tests deliberately do not live inside `check`: CI runs them
via the dedicated `nodejs.yml`/`test-ci` job, and `npm test` is the local full gate. `check:test` once
existed _because_ `run-p check:*` doesn't match `test`, and removing it silently dropped tests from the
gate — that trap is closed now; don't reopen it. If you want the complete gate, run `npm test`.

## Architecture

* **`lib/schema.js` is THE AUTHORITY.** `VALID_TYPES`, `VALID_STATUSES`, `VALID_PRIORITIES`,
  `REQUIRED_FIELDS`, and the store-name pair `TRACKER_DIRS` (`['diarium', '.diarium']`, visible
  first) live here; every reader/validator/migrator derives its vocabulary from it — never fork it.
  `TRACKER_LABEL` is the pair as one clause for error text. The store names live ONLY here; an
  ast-grep rule (`no-hardcoded-tracker-dir`) bans hardcoding them anywhere else — which is why
  messages interpolate `TRACKER_LABEL` instead of spelling the store out, so `store/root.js` and
  `store/init.js` stay guarded rather than exempted.
* **A guard checks the RETIRED names too** — `isAnyStoreDir` when you are about to HARM a store,
  `isTrackerDir` only when you are about to USE one. `LEGACY_TRACKER_DIRS` (`.diarie`) is never
  read, but `init`, migrate's overwrite check and `bd-map.js` all check it.
* **Which form is on disk is a FACT, not a constant** — and never index the pair.
  `trackerDirIn(root)` (`lib/store/root.js`) for the store that EXISTS, throwing `ETWOSTORES` on both;
  `defaultTrackerDir(dotted)` for the one to CREATE. Disk outranks the flag. There is no singular
  `TRACKER_DIR`, and `no-indexed-tracker-dir` enforces the rest.
* **Commands are FOUR parts** (peowly-commands shape): `run()` holds no logic → `setupCommand` parses →
  **`doTheWork` RETURNS DATA and never prints** → **`formatWorkResult` is the only writer**. `doTheWork`
  is exported so the work is assertable in-process (no spawn, no stdout capture). **`ready`, `stats`
  and `validate` are the three that actually have all four.** **`migrate` is deliberately NOT
  four-part** — don't convert it. **`init` is THREE parts and that is also deliberate**: it has no
  `doTheWork`, because creating a store is the store layer's job — the work is `initStore` in
  `lib/store/init.js`, exported from there and driven directly by `test/commands.spec.js`. What the
  shape buys is preserved; only the location differs, so do not "finish" `init` by moving the work
  into the command. But **assert every exit code through a spawned `cli.js`** (`test/cli.spec.js`):
  the `{error, code}` contract is produced at the boundary, not in the work stage, so an in-process
  test cannot see it.
* 🚨 **The published surface is an ALLOWLIST pinned by equality** (`test/api.spec.js`), over **both**
  entry points — `diarie` and `diarie/schema`. Adding an export is a deliberate act that costs a line
  in that list; it is not something a refactor may do in passing. The guard covers both doors because
  `TASKS_DIR`/`RECORD_DIRS` went public by being written into `lib/schema.js` — which `lib/index.js`
  re-exports with `export *` — so a guard on `lib/index.js` alone would have watched the wrong one.
  knip cannot do this job: it finds DEAD exports, never NEW ones. **There is no `lib/store.js`**; the
  `lib/store/` modules are named individually from `lib/index.js`, because a re-export barrel lets the
  public API widen from a file that does not look like the entry point. `initStore` stays INTERNAL
  (VISION.md: a CRUD layer would make diarie the owner of your data).
* **Flags live in `lib/flags/`** groups (`output`, `store`, `filter`, `staleness` + a barrel). Note the
  load-bearing asymmetry: `ready` resolves the store BEFORE validating `--filter`; `stats` validates
  first — this keeps `{code: ENOSTORE}` winning a double fault. Don't "tidy" it.

## The store + the 4 types

* **The store is the `diarium` PAIR** (decision `diarie-pos`): visible `diarium/` or dotted
  `.diarium/`, and which one exists on disk IS the choice — no config, no env var, nothing to read
  before the store can be found. `init` writes visible by default, `--dotted` writes the other, and
  `git mv` flips it whenever. **Exactly two forms, ever.** Both present is `ETWOSTORES` (a
  precedence rule would just make the ambiguity permanent); a legacy `.diarie/` is detected and
  NAMED with the `git mv`, and halts the upward walk rather than being stepped over — walking past
  it to an ancestor `diarium/` would read a real store belonging to someone else.
  **This repo runs the dotted posture** while the shipped default is visible; that divergence is
  deliberate and recorded in `diarie-pos`'s Revisions.
* `<store>/tasks/tasks-<slug>.yml` holds **`task` and `milestone`** rows. `<store>/decisions/<id>.md`
  and `<store>/docs/<id>.md` hold **`decision`/`doc`** as frontmatter + prose body (only the loader's
  `tasks-*.yml` glob feeds the ready computation, so records are naturally never surfaced as work).
  The subdirectory names live in `lib/schema.js` (`TASKS_DIR`, `RECORD_DIRS` — keyed by the type
  each is the home of); **`docs/` is declared there and created by nothing**, so its absence is
  ordinary and never an error. No ast-grep rule guards these the way one guards the store's own
  name — that convention is held by hand.
* 🚨 **`validate` reads the WHOLE store, `ready`/`stats` read only `tasks/`.** That asymmetry is the
  design, not a gap: records must never enter the ready computation, and they must never go
  unchecked. `validate` therefore parses every record's frontmatter, applies the same field rules a
  row gets (one implementation — `lintFields`), adds the two only a file can break (its `type` must
  match its directory, its id must match its filename), and **warns about anything else it finds in
  the store**. Records deliberately do NOT join the dep graph — admitting them would make a task's
  currently-dangling dep on a decision id start resolving, which is `diarie-rel`'s question to
  answer on purpose rather than a side effect. Before this, `check:tasks` validated **1 file and
  ignored 16**, and a transposed `decisons/` was invisible to every command at exit 0.
* **4 exclusive types**: `task` (work) / `doc` (reference) / `decision` (record) / `milestone` (marker).
  bd's other framings (`bug`/`feature`/`chore`/`story`/`spike`) ride in `labels:`; an epic is
  `task` + `parent:` (or an `epic` label). A type answers "what kind of thing", a label "how to think
  about it".
* **Ready rule** (the only computation that gates work): READY iff `type === 'task'`, `status ===
  'pending'`, every dep is `completed`, AND it is not a container (a task with open children or an
  `epic` label is the sum of its children, never work itself). Non-task types never appear in
  ready/blocked/needsAttention and never block.
* **Writers mutate the YAML directly (plain Edit/Write). There is deliberately NO CRUD helper** — the
  store is a substrate, not a product with an opinion about how you change it.
* 🚨 **Quote your dates: an unquoted `updated: 2026-05-30` is a YAML _date_, not a string.** Write
  `updated: '2026-05-30'`. The requirement is unchanged; **the failure mode is not — the drop is now
  REPORTED, and that is `diarie-rdr` fixed** (2026-08-04). The loader warns naming the consequence,
  the message says _"a YAML date, not a string — put it in quotes"_ (rendering a `Date` through
  `JSON.stringify` would print `"2026-05-30T00:00:00.000Z"`, quotes and all, inside a sentence
  claiming it is not a string), `validate` errors, and `ready --strict` exits **2** where it used to
  exit 0. Four fields were silent — `title`, `agent`, `updated`, `description` — while their six
  siblings reported; `unsound` is computed from `warnings.length`, so `--strict` was answering
  "trustworthy" _because_ the drop was quiet.
* **`migrate` refuses rather than dropping data it cannot map** (`ELOSSY`; `--lossy` overrides). Its
  `IGNORED_BD_FIELDS` allowlist is the hazard: every addition is a data-loss decision.
* **Atomic-write contract**: solo, single-host, no concurrent writers to the same `tasks-<slug>.yml`.
  Anything that fans work out in parallel must partition by file (one owner per slug).

## Exit codes (load-bearing — a machine consumer branches on these)

* `0` — success; the answer is on stdout. Also: a **genuinely bare `diarie`**, or an explicit
  `--help`/`--version`, prints the help and exits 0 — the npm/yarn convention, and the one
  deliberate exception to the `--json`-errors-on-stdout rule. 🚨 **The exception is NARROW and the
  narrowness is the decision** (`diarie-ncm`): a **flag standing where a command belongs** —
  `diarie --json ready`, `diarie -h`, `diarie ""` — is **EUSAGE/exit 1**, because peowly-commands
  discards `args[0]` when it starts with `-` and the command would vanish under a success code.
  `git --short status` exits 129 for the identical shape; no comparable CLI silently succeeds.
* `1` — `InputError` ("you got it wrong"). Under `--json`, emitted as JSON on **stdout** with a `code`:
  **`ENOSTORE`** (no store here — the most important one), **`EUSAGE`** (bad command name, a bad
  flag/value **on a named command**, a flag where a command belongs, incl. a
  stale `TASKS_ROOT` in any command that reads the env — `migrate` reads none, by design, and says
  so), **`EEXIST`** (`init` or `migrate` refusing an existing store, in either posture),
  **`ETWOSTORES`** (both forms of the pair present — refuses to guess), **`ELEGACY`** (`init`
  refusing to start a second store beside a `.diarie/`), **`ELOSSY`** (`migrate` refusing to drop
  data it cannot map), **`EPLUGINSTORE`** (the walk-up landed inside an installed plugin's OWN
  store — its own code because ENOSTORE's documented remedy is `diarie init`, which here would
  create a store inside the plugin cache).
* `2` — `ResultError` ("it ran; the answer is no": invalid store, `--strict`). **NOTHING ELSE MAY USE
  2** — it's reserved so CI can tell a dependency cycle from a typo. Only `lib/utils/exit.js` writes it.
* The vocabulary is `VALID_ERROR_CODES` in `lib/schema.js`; the shapes are `lib/utils/errors.js`,
  which imports nothing and is the base every layer may depend on. Anything reaching `cli.js` must
  BE an `InputError` or `ResultError` — the store errors extend it rather than being converted at a
  call site. **Adding a code costs SEVEN surfaces, and only ONE of them is gated** (measured
  2026-08-05): `lib/schema.js` twice — the array _and_ the hand-written prose above it — plus a case
  in `test/cli.spec.js`'s boundary table (the gate: it fails if a code goes unexercised), README's
  exit-code row, the bullet above, and **`brand/index.html`, `brand/brand-book.html` and
  `brand/tokens.json`, which carry the vocabulary as prose and are gated by nothing**. This bullet
  used to name only the test, which is how the brand surfaces drift. `InputError` is exported from
  `lib/index.js`.

## Conventions & gotchas

* **ESM only**, JSDoc types (`tsc` checks, never compiles), **neostandard** via
  `@voxpelli/eslint-config` (semicolons on). Prefer `unknown` + type guards over `any`.
* **`.gitignore` is load-bearing for lint scope.** `check:ast-grep` takes no path args and is bounded
  by `.gitignore`, and `check:md` runs `--ignore-path .gitignore`, so adding a broad ignore entry
  SILENTLY shrinks lint coverage with nothing going red. Treat every `.gitignore` line as a lint-scope
  decision. There is now a SECOND scope lever: `check:ast-grep` also carries `--globs '!.design-sync/**' --globs '!.impeccable/**'` (agent-tooling state). Those are declarative — ast-grep's walker already
  skips dot-directories, so they exclude nothing that was scanned before — but a `--globs` added to that
  script IS a coverage decision and belongs in this bullet. (See `sgconfig.yml` for the reasoning.)
  The Litho agent bundle is a THIRD lever, and it differs in kind: `.litho/` (dot-dir, tool state —
  skipped natively anyway) and **`litho.docs/` (NOT a dot-dir: \~250 KB of generated markdown that
  `check:md`/`check:ast-grep` now skip via .gitignore)** — a real coverage exclusion, deliberate
  because it is generated, recorded here so it stays deliberate.
* **When a change ADDS to a vocabulary** (exit codes, a `VALID_*` enum, flags), grep the set's OTHER
  members, not the new name — that is what finds the surfaces that enumerate it. A token-grep cannot.
* **ast-grep runs 11 rules from TWO ruleDirs** (`sgconfig.yml`). `@voxpelli/ast-grep-rules` owns the
  3 house conventions (no JSDoc `any`, no `object` typedef, no inline JSDoc `import()`), tested
  upstream. `.ast-grep/rules/` owns the 8 that encode diarie's OWN invariants — no hardcoded tracker
  dir, no INDEXED tracker dir, no unsanctioned `exit(2)`, no computed exit code, no CommonJS
  `require`, no identifier-shadow call, no identical test titles, no platform `node:path/{posix,win32}`
  import — and each of those is paired with a rule-test, so `ast-grep test` covers 8, not 11. Two
  pairs exist where one rule closes another's blind spot; each rule's own message says which.
  **`no-platform-path-import` is the one rule that exists because no TEST could do the job**: it
  guards a Windows-only defect, and CI is `ubuntu-latest` only, so a suite that cannot run on the
  platform in question is not evidence. Untestable-on-CI raises a finding's severity; it does not
  lower it.
* **Generated `.d.ts`** (`lib/**/*.d.ts`) are gitignored build artifacts, packed via `files`/`prepack`,
  and eslint-ignored — but a hand-written ambient `*-types.d.ts` stays linted and committed.
* **`check:md` lints every tracked `.md`** (`remark . --frail`, bounded by `.gitignore`) — this
  file, README, and the decision/brand docs, with no exclusions (decision `diarie-tbl`: "no unlinted
  island"). `fix:md` (`remark . -o`) auto-formats tables/markers/links in place — run it to fix a
  table rather than hand-aligning cells. `remark-validate-links` catches broken relative links.
  `brand/DESIGN.md` additionally carries a separate `@google/design.md` lint (its own header records
  the accepted-warnings status) — that is NOT part of `check:md`.
* **`brand/index.html` inlines its OWN subset of `tokens.css`**, so its conventions live in the page
  and drift from the token file silently. Terminal ink is **five** classes — `.c` prompt/comment,
  `.g` fosfor, `.k` lavendel, `.a` bärnsten, `.r` stämpel-ljus — the set `brand-book.html` already
  defines; shipping four costs the page its only amber, and amber is a load-bearing citizen (the
  palette's answer to "dark ground + one green accent" being the AI default). Prose measure is
  `.measure` / `.measure-c` (34rem), never an inline `max-width`. Stacking is `--z-bakom` /
  `--z-korn` / `--z-ledger`, never a bare integer. `.term.wrapped` opts a block into `pre-wrap`:
  `diarie` pads no columns (fields are single-space separated), so a wrap costs no alignment and
  beats hiding half a message behind a horizontal scroll.
* 🚨 **A verification tool that answers a NARROWER question than you asked reports success on
  broken output — and never errors.** This bit four times in one session on `brand/`, always the
  same shape: the tool was fine, the question was not the one being asked.

  | Claim under test                 | Wrong instrument                 | Why it lies                                                                                                     | Right instrument                                                                 |
  | -------------------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
  | terminal not clipped             | `term.scrollWidth - clientWidth` | `.term` has `overflow-x:auto`, so it reports 0 while the `<pre>` inside is cut mid-glyph                        | `pre.scrollWidth` vs the term's content box, or the widest line's rendered width |
  | root `DESIGN.md` is a stray copy | `diff` + `git ls-files`          | `diff` follows symlinks and a symlink is untracked — identical + untracked is exactly what a symlink looks like | `ls -l` / `test -L`                                                              |
  | footer renders two-up            | comparing element `top`          | `align-items:center` guarantees row-mates have different tops                                                   | horizontal adjacency (`b.left >= a.right`)                                       |
  | prose measure is 64ch            | the CSS `ch` unit                | `ch` is the advance of `0` — 11.05px in Fraunces vs a \~7.5px mean character, \~45% under                       | record the width in rem; the character count is derived and method-dependent     |

  Before writing "verified" or "measured", state which question the instrument actually answers.
  Also: `cmd | head` returns `head`'s exit code, so `echo "exit=$?"` after a pipe measures the
  wrong process — use `PIPESTATUS` or drop the pipe.

## Remotes & publishing (dual-home)

`diarie` is public on **Tangled** (tangled.org/voxpelli.com/diarie — the development home for
issues + PRs), **npm**, and **GitHub** (voxpelli/diarie — a mirror: issues disabled, PR creation
collaborators-only). README, `CONTRIBUTING.md`, and the diarie.dev footer point contributors to
Tangled; keep those pointers **host-neutral** (the same files publish to both forges — never write
"this repo is a mirror").

* **GitHub exists primarily as the release backend.** npm OIDC trusted publishing works from GitHub
  Actions (and GitLab/CircleCI) but **not from Tangled**, so the release-please + OIDC workflow must
  run on GitHub — the main reason to keep the mirror (public discoverability, npm provenance, and
  DeepWiki are secondary). Releases are automated (never
  `npm publish` by hand); version tags and the `release-please--*` branch are born **server-side on
  GitHub**.
* **Tangled has no pull-mirror**, so those GitHub-born refs reach it only when pushed — keeping
  Tangled in sync is a manual push after each release (mechanism deferred, row `diarie-tgl`). Never a
  whole-repo `--mirror`/`--all` push: it would leak the release-please branch to Tangled.
* **Remote names and any push fan-out are per-checkout** (local git config, not committed) — run
  `git remote -v` to see this checkout's setup; a fresh clone has only the remote it came from.

## Guardrails

* Use ESM syntax only. Keep changes minimal and consistent with the surrounding file's style.
* Add tests for new behaviour (`test/*.spec.js`, `node:test`); validate with `npm test` before finishing.
* This repo tracks its own work in `.diarium/` — say "record a task" / "add a row", never "file a bead".
* The old `private`/npm-name gate is **lifted** — `diarie` is public on Tangled, npm, and GitHub.
  Releases go through release-please (see Remotes & publishing); never `npm publish` by hand,
  and never push without an explicit, in-the-moment go-ahead.
