---
id: diarie-ncm
title: A bare `diarie` prints help and exits 0; a flag standing where a command belongs is EUSAGE
status: pending
type: decision
priority: high
updated: '2026-08-04'
---

## Decision

**Decided 2026-08-04.** Exactly three invocations are *orientation* and exit 0 with help on stdout:

| invocation | exit | stdout |
| ---------- | ---- | ------ |
| `diarie` | 0 | help — the npm/yarn convention |
| `diarie --help` | 0 | help (peowly answers) |
| `diarie --version` | 0 | the version (peowly answers) |

**Everything else is a mistake: `InputError` / `EUSAGE` / exit 1, with JSON on stdout under `--json`.**
That includes `diarie ""`, `diarie --json`, `diarie -j`, `diarie -h`, `diarie --nosuchflag`, and —
the one this decision exists for — `diarie --json ready`. Unknown command *names*
(`diarie frobnicate`) and bad flags *on a named command* (`diarie ready --nosuchflag`) were always
EUSAGE and stay so.

## Why the line falls there

A **forgotten** command is a request for orientation. A **discarded** one is a mistake, and the
difference is not stylistic — it is the difference between the two answers a tracker may give.

`peowly-commands` nulls out `args[0]` when it is falsy or starts with `-`
(`lib/main.js:29-33`) and never looks past it. So `diarie --json ready` reads as "no command given":
`ready` is silently discarded, help is printed, and the exit code is 0. A wrapper running
`diarie --json ready | jq '.ready'` gets prose, `jq` fails, the wrapper falls back to "no work" —
**and the exit code reports success.** That is this package's founding defect, served by its own
entry point, under the flag that promises machine-readable output.

An earlier draft of this record ratified that: it declared *"any leading-dash flag with no command"*
to be orientation, reading peowly's `:31-33` behaviour as an upstream *convention*. It is an upstream
**bug**, and the appeal to npm was backwards. Measured rather than assumed:

| invocation | exit | ran the command? |
| ---------- | ---- | ---------------- |
| `git --short status` | **129** | no — `unknown option: --short` |
| `git --oneline log` | **129** | no |
| `cargo --nosuchflag build` | **1** | no |
| `gh --nosuchflag repo` | **1** | no |
| `npm --json ls` | 0 | **yes — routed it** |
| `npm --nosuchflag ls` | 0 | yes, **with a warning on stderr** |

Every comparable tool either routes the flag and runs the command, or refuses with a non-zero exit
naming the offending token. **Not one silently succeeds.** npm — the very convention the earlier
draft invoked — is the most permissive of the set and still does both. npm's convention is *be
helpful when no command is given*, not *swallow a command that was given*.

`git status --short` works and `git --short status` exits 129. `diarie ready --json` and
`diarie --json ready` have exactly that shape, and must answer the same way.

## Two sub-decisions worth stating outright

**`diarie ""` is EUSAGE, not orientation.** `diarie "$CMD"` with an unset variable is how a wrapper
script writes it — so an empty first argument is a bug *in the wrapper*, and exit 0 plus prose is
precisely what makes it invisible. (Upstream cannot currently distinguish it: `peowly-commands`
funnels a named-but-empty command and no command at all to the same terminus, and
`PeowlyCommandOmittedError` carries no args. Logged as upstream friction.)

**`-h` is dropped, and that is stricter than both `main` and the branch.** peowly defines only the
long forms. `diarie -h` printed help purely *because it starts with a dash* — the identical accident
as `diarie --json ready` — while `diarie ready -h` has always been EUSAGE. Adding `-h` as an alias
would have papered over that asymmetry; peowly sets the standard for its own flag vocabulary, so the
alias is not diarie's to invent. `diarie -h` now exits 1 like any other unrecognised flag.

## The cost, stated on record

The `--json`-errors-on-stdout guarantee still has exactly one exception: a genuinely bare `diarie`,
or an explicit `--help`, prints human help to stdout and exits 0 even under `--json`. That is a
deliberate, *narrow* exception — the user asked for orientation, so orientation is the right answer
in every mode — and it is far smaller than the earlier draft's, which covered every leading-dash
token and therefore covered the founding defect.

Consumer-facing surfaces that state it: `cli.js`'s header, `lib/cli.js`, `README.md`'s exit table,
`CLAUDE.md`'s exit-code section, and `lib/schema.js`'s EUSAGE line. `test/cli.spec.js`'s THE
INVARIANT suite pins the split, and a dedicated regression test pins `diarie --json ready`.

## Consequences

* `lib/cli.js` classifies **before** dispatch, then hands the bare case to peowly-commands' own
  `showHelpOnNoCommand: true`. The classification is categorical, not a heuristic: diarie passes
  `peowlyCommands` no flag options, so its entire top-level vocabulary is `--help` and `--version`,
  and any other leading-dash first token is unroutable *by construction*.
* The guard is gated on peowly dispatching nothing, so it is unreachable for any invocation that
  currently runs a command. **No working command line can regress through it.**
* Detection of *which* token was misplaced feeds only the suggestion, never the exit code. A hint
  that is sometimes wrong is honest; an exit code that is sometimes wrong is the founding defect.
* Exit 0 now has two meanings: "the answer is on stdout" and "here is the help". The README's `0`
  row says both.
* Using `showHelpOnNoCommand` rather than catching `PeowlyCommandOmittedError` by hand keeps the
  explicit `0` as upstream's own tested literal. Forgetting it would let peowly default to
  `process.exit(2)` — the code this repo reserves for `ResultError` — and the `no-unsanctioned-exit-2`
  ast-grep rule cannot see a library call, only a literal, so nothing would have gone red.
* `process.exit(0)` via `showHelp` is accepted: the help is well under a kilobyte, two orders of
  magnitude below the 64 KB pipe buffer that made `process.exit()` the founding defect. **No byte
  count is recorded here on purpose** — roughly 40% of the help is command-description text, so any
  measured digit rots on the next reword. If a future surface ever approaches that buffer, `showHelp`
  must stop being `process.exit`.

## Revival triggers

Revisit this record if any of these become true:

* **diarie gains a genuine top-level flag.** The categorical argument rests on the vocabulary being
  exactly `--help` and `--version`; a third member makes the classification a real decision again.
* **Aliases are passed to `peowlyCommands`.** The misplaced-command hint matches own keys of
  `commands` only, so an alias would go unrecognised — `diarie --json <alias>` would still refuse
  correctly, but without naming the fix.
* **Anyone reports a piped bare `diarie --json` in the wild.** The narrow exception assumes nobody
  machine-consumes the orientation path.
