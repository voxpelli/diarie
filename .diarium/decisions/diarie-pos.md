---
id: diarie-pos
title: Where does the store live? — `diarium/` or `.diarium/`, the repo's posture, visible by default
status: pending
type: decision
priority: high
updated: '2026-07-28'
---

## Decision

**Decided 2026-07-28:** the store is named `diarium`, in exactly one of two forms — visible
`diarium/` or dotted `.diarium/`. `diarie init` writes the visible form by default; `init --dotted`
writes the other, beside the existing `--slug` flag. The choice is expressed by which directory
exists on disk — no config key, no environment variable, nothing to resolve before the store can be
found — and it is reversible at any time with one `git mv`, since the reader accepts both forms.
**Exactly two forms, ever: a third reopens this decision.**

This does not reverse the 2026-07-11 rename (`backlog/` → `.diarie/`); it preserves it. Everything
that rename bought — a product-namespaced segment that cannot collide, committed-not-ephemeral
(cf. `.claude/`, `.github/`; NOT `.beads/`, which was gitignored tool state) — lives on as the
dotted posture, one of the pair's two forms. What the pair adds is the visible form, for repos
whose register should not need `ls -a` to be seen.

## The arc, kept honest

The store was born visible as `backlog/` — a generic noun with live collision risk (Backlog.md
claims the same segment) — and was renamed to `.diarie/` on 2026-07-11 for namespacing, with the
rationale recorded on `TRACKER_DIR` in `lib/schema.js`. A later review re-derived the dot from a
`.git` analogy; that justification was retired as backwards (`.git/` hides what you must _not_
hand-edit; this store is hand-edited), and the strongest standing objection was recorded —
BRAND.md's anchor: the diarium is "recorded, numbered, findable, **never hidden**."

The law was consulted: OSL (2009:400) 5 kap. 1 § plus förarbetena (prop. 1979/80:2, Del A, s. 358 —
the register "måste ju kunna hållas allmänt tillgängligt") require the register be kept generally
accessible on approach, not proactively published. The dot satisfied the statute. The author first
ruled that the brand exceeds the statute (flip to visible), then on re-examination — the ruling had
partly rested on reading the law as demanding visibility — landed on genuine undecidedness grounded
in real variance: **visibility legitimately differs between projects, as it differs between
myndigheter.** Webbdiarier exist and are voluntary; some were withdrawn under GDPR pressure.
Agencies differ in _posture_, never in _name_. That observation is this decision. The statute fixes
the register; the myndighet chooses the posture. diarie does what the law does.

## Why the name is `diarium`, in both forms

Ruled on cross-language legibility. English _diary_ descends from Latin _diarium_; the _-arium_
family (aquarium, herbarium — the mark's own family) reads as "a container for X" across English,
German, and the Romance languages, so the cold reader gets "container of daily records" with no
tool knowledge. `diarie` cold scans as a misspelling of _diary_, one transposition from _dairy_,
and names the folder after the tool — which the ownership pitch contradicts. _Diarium_ is also the
more correct Swedish (the standalone noun is _ett diarium_; _diarie-_ is the combining form, as in
_diarienummer_). The product-namespacing that motivated the 07-11 rename survives in the _name_
rather than the dot: `diarium` is diarie's own noun, uncommon as a directory segment in either
form. The pairing teaches itself in four words: **diarie tends the diarium.**

## The two postures

* **Visible `diarium/` — the webbdiarium posture (default).** The anchor at full strength:
  findable on every surface, bare `ls` and Finder included. Authored content where authored-content
  convention puts it. Every walker and formatter reaches it without flags. First contact solved at
  the root; the folder's name is its own introduction.
* **Dotted `.diarium/` — the reading-room posture.** The store-not-source read, free protection
  from default tool runs (formatters, lint globs, bare `rg`/`fd` skip dot-directories), and the
  full namespace shelter the 07-11 rename chose. Committed, diffable, one `ls -a` away — the
  statute's own floor. Fit for quieter repos and agent workbenches.

Both satisfy the anchor's legal reading; the visible one exceeds it. The repo — not the tool —
knows which it is.

## The contract

* **Presence on disk is the switch.** Self-describing on clone; no bootstrapping loop; two clones
  cannot disagree.
* **The reader accepts exactly the pair**, walking upward as before, and `ENOSTORE` keeps its
  existing two honest variants — searched ("…or any parent") versus explicit `--root` — with the
  pair folded in: "no `diarium/` (dotted or not) found in X or any parent — run `diarie init`, or
  pass --root <dir>". The machine `code` rides for `--json` consumers, unchanged.
* **Both forms present is a hard error** — suggested `ETWOSTORES` — naming both paths and refusing
  to guess. Precedence rules are how ambiguity becomes permanent; an error is how it gets fixed.
* **Legacy `.diarie/` is detected and named**, with the command per posture: `git mv .diarie
  diarium` or `git mv .diarie .diarium`.
* **Posture is cheap to change, forever**: `git mv diarium .diarium` and everything keeps working.

## Costs, named

* **The deno tax, knowingly paid.** `deno.json`/`.jsonc` shows a two-name set puts an "or" into
  every sentence naming the file. Docs, agent instructions, and error text carry "dotted or not" —
  one clause, forever. Weighed against forcing one posture onto repos that legitimately differ,
  the clause wins; the fence (exactly two, ever) keeps the clause from becoming a list.
* **The one-line-rename premise becomes structural.** `TRACKER_DIR` is a single constant whose
  design goal — and whose ast-grep guard, `no-hardcoded-tracker-dir` — assume one segment. The
  pair needs pair-aware resolution in `store.js`, the `ETWOSTORES` edge, and a rule update where
  `.diarie` joins `backlog/` as flagged legacy. Honest accounting: this is the first change the
  constant's "renaming is a one-line change" promise cannot absorb alone.
* **Tooling guidance forks by posture.** Visible repos may want `.prettierignore` and lint
  excludes; dotted repos need `--hidden`/`--dot`/`dot: true` to get checking tools in.
* **Gitignore still trumps posture** for gitignore-respecting tools (Cursor and Copilot indexing,
  `rg` defaults): a gitignored store is invisible to them in either form. Documented, not
  enforced — `validate` stays out of it (ruled 2026-07-28).

## Alternatives Considered

* **A single forced visible default** — the interim ruling. Set aside on re-examination: part of
  its weight rested on misreading the law as demanding visibility; corrected, genuine per-repo
  variance remained and is better encoded than overridden.
* **A single forced dotted default (status quo)** — the mirror; it forces the reading-room posture
  on registers that want to be webbdiarier.
* **Full location configurability** — still refused; that belongs to [diarie-loc](./diarie-loc.md)
  and stands. The observed variance is a binary posture, not a continuous location: agencies
  choose web-or-desk; none renames the diarium.
* **`diarie/` spelling** — lost the language ruling and the ownership logic.
* **`docs/decisions/` + `tasks/` split** — fragments one atomic store; right for documentation
  tools, wrong for a typed store.
* **`_diarium/`** — Jekyll, Docusaurus, Sass, Next.js, and the Go toolchain treat a leading
  underscore as ignored, partial, or private; a silently-dropped store is a footgun, not a third
  posture.

## Affects

* `lib/schema.js` `TRACKER_DIR` → the `diarium` pair; `lib/store.js` pair-aware `resolveRoot` +
  `ETWOSTORES`; `NoStoreError` text gains "(dotted or not)".
* `lib/commands/init.js`: default `diarium/`, add `--dotted`; keep the existing refuse-to-clobber
  and add the non-store-collision refusal.
* `.ast-grep/rules/no-hardcoded-tracker-dir.yml`: regex and prose updated; `.diarie` becomes
  flagged legacy alongside `backlog/`.
* Tests and fixtures (`test/fixtures*/.diarie/`), README (store table, examples, `ENOSTORE`
  sample), CLAUDE.md, CHANGELOG forward prose, BRAND.md and diarie.dev where the path is named.
* This repo's own store: choose its posture and `git mv .diarie` accordingly — the shipped default
  is the natural dogfood; the author holds the pen.
* Teaching lines for the docs: "diarie tends the diarium"; "the statute fixes the register; the
  myndighet chooses the posture."

## Revival triggers

* `ETWOSTORES` recurs in the wild — reconsider whether a precedence rule beats the error.
* Demand for a third form appears — reopens this decision, and should arrive with a variance
  argument as concrete as the one that created the pair.
* One posture goes effectively unused across adopters — collapse the pair at a major, by the
  mechanics in [diarie-loc](./diarie-loc.md).
* Sustained evidence that `diarium` confuses in practice where `diarie` would not — observed, not
  conjectured.

## Revisions

* 2026-07-28 — **filed and implemented in the same change.** Three things the record did not
  itself decide, recorded here so they are not read later as drift:
  1. **This repo runs the dotted posture.** `init`'s shipped default is the visible form, as
     decided above; diarie's own store is `.diarium/`. The author held the pen, which is what
     "the repo — not the tool — knows which it is" means. The default and the dogfood diverging
     is the pair working, not a mistake.
  2. **A second code, `ELEGACY`, was minted.** This record names `ETWOSTORES` and says legacy is
     "detected and named", but a _read_ that reports `ENOSTORE` invites a caller to helpfully run
     `init` — which would create a second store beside the legacy one. So the read path keeps
     `ENOSTORE` (there genuinely is no diarium here) and enriches the message, while `init`
     refuses outright with `ELEGACY`. The harm is caught where it would actually happen.
  3. **Legacy detection is `.diarie` only, not `backlog/`.** The ast-grep rule still flags
     `backlog/` _literals in code_; the runtime does not treat a `backlog/` directory as a store,
     because it is an ordinary directory name in countless repos and refusing on it would be a
     false positive on a generic noun. The two lists are different jobs.
* 2026-07-28 — re-cut against the repo: the `backlog/` first act and the 07-11 namespacing
  rationale added to the arc (the pair _preserves_ that rename as its dotted posture); frontmatter
  and id matched to store conventions (`diarie-pos`, provisional mint); `ENOSTORE` prescription
  inherits the shipped two-variant structure; the single-constant/ast-grep friction named; the
  stale "v0.2.0 window" corrected to the pre-1.0 window (0.2.x, small installed base).
* 2026-07-28 — synthesized into the pair after the forced-visible ruling was re-examined ("a bit
  of both"): one name, one posture bit, expressed on disk, visible by default, fenced at two.
* 2026-07-28 — named `diarium`, ruled on cross-language legibility.
* 2026-07-28 — flipped to visible: the named trigger — the brand exceeds the statute — pulled
  inside the pre-1.0 window.
* 2026-07-28 — earlier the same day: the dot held provisionally after source verification; the
  `.git` justification retired; the brand-anchor objection recorded with the narrow reading
  sourced to OSL and förarbetena.
