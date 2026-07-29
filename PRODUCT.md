# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

<!-- Reads oddly, and is the closest true value: this field names a DESIGNED
     SURFACE, not the product, and its vocabulary is web/ios/android/adaptive —
     there is no `cli`. diarie itself is a terminal program with no GUI.

     There are TWO designed surfaces, and only one of them is web:
       1. diarie.dev (the `brand/` pages) — built, and what `web` refers to.
       2. The CLI's own terminal output — a first-class surface of the same
          design system, specified in BRAND.md ("## Applications"), not yet
          built. See Capabilities and Constraints.
     Do not read `web` as "diarie is a web product", and do not treat the CLI as
     undesigned merely because this axis cannot name it. -->

## Users

Solo developers who keep a backlog _in_ their repo — and the AI agents that
share that backlog with them. Their context is a git working tree, an editor,
and a terminal; their scar is a tracker that became a migration project. They
are distrustful of lock-in and fluent in local-first / indieweb values.

The brand surface (diarie.dev, the `brand/` pages) speaks to the skeptical
arrival: someone who reads "another task tracker?" and expects to be sold to.
The page's job is to earn trust in under a screen from a reader who will judge
the argument by whether the artifact making it is honest.

## Product Purpose

diarie is a flat-YAML task tracker that is _just files_: the CLI reads a backlog
your editor writes, and refuses to misrepresent itself. It exists to fix one
class of bug — **a tracker that cannot find its store must never look like an
empty backlog.** Git is the database; leaving is free; uninstall it and the
backlog is still there.

diarie.dev exists to make that argument _credibly_, not loudly. Success is a
developer trusting diarie with a real backlog because the page itself
demonstrated the ethos: one static document, zero external requests, view-source
honest, no tracking, survives `curl` / `file://` / the Internet Archive. The
medium is the proof.

## Positioning

**Leaving is free — the store outlives the tool.** The backlog is ordinary
committed files, so uninstalling diarie leaves it exactly where it was. A
tracker that owns a database, a daemon, or a sync protocol cannot truthfully
make that claim, and that is the whole of the difference.

The exit-code contract is the _evidence_ for that stance, not the headline: a
tool willing to report its own absence as an error (`ENOSTORE`, exit 1) rather
than as an empty backlog is a tool that is not trying to make itself
indispensable. Read the order that way — the refusal to trap you is the claim;
the honest reader is how you can check it.

## Operating Context

The unit of work is a git working tree. Everything happens in an editor and a
terminal: the store is `diarium/` (or `.diarium/`), the editor writes YAML, git
reviews it, and the CLI only reads. There is no server, no account, no
onboarding, and nothing to run before the store can be found.

Humans and AI coding agents share one backlog in the same repo — that is the
scenario the design targets, and it is demonstrated in two repos today (see
Evidence on Hand). The agent side is why `--json`, machine-readable error codes
on stdout, and a documented exit-code contract are product requirements rather
than conveniences.

The project is dual-homed: Tangled is the development home (issues and PRs),
GitHub is a mirror kept mainly because npm OIDC trusted publishing runs from
GitHub Actions, and releases are automated through release-please. Contributor
pointers must stay host-neutral because the same files publish to both forges.

## Brand Personality

Three words: **registry-honest, herbarium-warm, klarspråk-plain.**

The voice is _klarspråk_ — cared-for, simple, comprehensible (Språklagen
2009:600 §11), the register of a Swedish myndighet's registry at its best. It
names the consequence, not the adjective ("invalid priority `urgent` — it will
be treated as `medium`", never "invalid input"). The refusal is part of the
product: say no plainly, give the reason, name the revival trigger, never
apologize for a design decision. No superlatives. `diarie` is always lowercase —
it is a command, not a company. The tool is never anthropomorphized past its one
licensed phrase: _the reader is honest._ Swedish is seasoning, glossed on first
use — never a gatekeeping handshake.

The emotional target is **calm confidence**, not delight or urgency — the
smallest possible claim on the reader's attention (calm technology). A skeptical
developer should relax, not be excited.

## Anti-references

The identity is defined as much by what it refuses. This page must NOT look or
sound like:

* **The default 2026 AI aesthetic** — dark ground + a single acid-green accent,
  full stop. diarie's palette _is_ dark-with-green, so specificity has to be
  earned by everything the default lacks: paper, the stamps, stepped light,
  amber and red as full citizens, and accents that are checkable semantic claims.
  If it could read as "AI made that," it has failed.
* **SaaS landing tropes** — the hero-metric template (big number + gradient
  accent), identical icon-heading-text card grids, a tracked uppercase eyebrow
  above every section, stars-counter theater, "trusted by" logo walls.
* **Marketing vocabulary** — _blazing, seamless, powerful, supercharge,
  game-changing, simply, just_ (the adverb), and any sentence beginning
  "Unlock". Any sentence that would survive unchanged on a generic SaaS page is
  wrong.
* **Decorative effects** — gradient text, gradient glow (the halo is _stepped_
  risograph light, never lens flare), glassmorphism as default, side-stripe
  accent borders, a mascot (the twinflower is a specimen, not a character).
* **Dark-pattern motion** — pulsing CTAs, fake urgency, confetti at the moment
  of a decision. Motion never leans on a choice.
* **Anything that betrays the thesis** — tracking, cookies, a consent banner, a
  third-party font CDN, analytics, or a brand asset behind a login. A registry
  that surveils its readers has misunderstood which way the transparency goes.

## Design Principles

1. **Practice what you preach.** The artifact must embody its own argument. A
   page that says "own your data, no lock-in" ships as one static HTML document,
   zero external requests, self-hosted fonts, view-source honest. The medium is
   the evidence; if the page needed a third party to render its own name, it
   would have lost the argument the project exists to make.
2. **The refusal is the pitch.** Leaving is free, and saying so is the brand.
   Make the exit the closing line on any surface; present non-goals as identity,
   never as apology.
3. **Every accent is a claim you can check.** Color, motion, and copy map to the
   tool's real semantics — the exit-code contract in visual form (`fosfor` =
   exit 0 / ready, `bärnsten` = exit 1, `stämpel` = exit 2 / the rejection
   stamp). Nothing decorative may be mistaken for meaning.
4. **Name the consequence, not the adjective.** klarspråk over marketing: plain
   claims, glossed loanwords, no superlatives. The strongest available sentence
   is "That is the whole product."
5. **Scarcity makes the system legible.** One anchor (the diarium), two
   subordinate motifs (herbarium, genomlysning), two typefaces, one easing,
   semantic-only accents, at most three motion beats per page. Restraint is the
   identity itself, not minimalism worn as a style.

## Capabilities and Constraints

A **library with a bin**: published to npm as `diarie` (MIT, ESM only, Node
`^22.13.0 || >=24.0.0`) with both a `diarie` binary and importable exports
(`diarie` and `diarie/schema`), so the same reader the CLI uses is available to
a script or an agent.

The store is the `diarium` pair — visible `diarium/` or dotted `.diarium/`, and
which one exists on disk _is_ the choice. Task and milestone rows live in
`<store>/tasks/tasks-<slug>.yml`; decisions and docs are frontmatter + prose
under `<store>/decisions/` and `<store>/docs/`. Four exclusive types (`task`,
`doc`, `decision`, `milestone`); other framings ride in `labels:`. Exit codes
are a contract a machine consumer branches on: `0` success, `1` `InputError`
with a machine-readable code, `2` `ResultError` and nothing else.

**Never, by construction:** a daemon, a database, a sync protocol, git hooks, a
CRUD write layer, or a web dashboard. These are refusals with named revival
triggers, not a backlog.

**Concurrency is deliberately narrow:** the atomic-write contract assumes solo,
single-host use with no concurrent writers to the same `tasks-<slug>.yml`. Work
fanned out in parallel must partition by file.

**The CLI is a designed surface, decided but unbuilt.** BRAND.md's
"## Applications" already assigns it the semantic tokens — ready rows in
`fosfor`, stale claims in `bärnsten`, `validate` findings in `stämpel`,
structure in `lavendel` — with `NO_COLOR` and non-TTY output respected without
information loss, because colour is annotation and never the message. Today the
CLI emits **no ANSI at all**; the work is tracked as `diarie-col`. Two
constraints ride with it and must survive: colour may never be the only carrier
of meaning, and it may not be bought with weight — `lib/format.js` rejected
`markdown-or-chalk` at 83 transitive packages and \~10 MB (its `cli-highlight`
drags in `yargs@16`, the very thing `peowly` was chosen to avoid).

That refusal carries a **named revival trigger**, as every refusal here must.
Re-measured 2026-07-29: the current `0.3.2` still costs **80 packages / 10 MB**,
so the reasoning holds today. The trigger is **0.4.x** — [PR
\#47](https://github.com/voxpelli/markdown-or-chalk/pull/47), open at the time of
writing — which drops `chalk` for `node:util`'s `styleText` and demotes `boxen`
and `emphasize` to optional peer dependencies. Re-measure when it lands. Note it
also raises `engines` to `^22.19.0 || >=24.5.0`, above diarie's current floor, so
adopting it is a Node-support decision as well as a dependency one.

Until colour ships, every coloured terminal block on a brand surface is an
editorial illustration of the token contract, not a screenshot.

**Explicitly undecided** (tracked, not inferred): unification of the id scheme
(`diarie-xid`), the relation model beyond `deps`/`parent` (`diarie-rel`), a
non-dep-gated `diarie list` reader (`diarie-lst`), and an ADR-style status
vocabulary for decision records (`diarie-dsv`).

## Evidence on Hand

**Real and citable:**

* The artifact itself — npm `diarie` 0.2.2, public on Tangled and mirrored to
  GitHub, MIT.
* diarie tracks its own work in `.diarium/` — 42 rows, actively worked
  (verified 2026-07-29). This is the primary demonstration.
* `../vp-beads` consumes `diarie ^0.2.0` as a devDependency and, on branch
  `feat/tracker-design-exploration`, holds a real store: three task files, four
  decision records, and a `bd-final-export.jsonl` archive of its predecessor.
  It sits at the **legacy `.diarie/` name** (created before the `diarium`
  rename), so diarie currently refuses to read it — `ENOSTORE`, exit 1, naming
  the `git mv` that fixes it — and `.beads/` is still present alongside. Real
  adoption, on an unmerged branch, blocked on a rename. Describe it that way and
  never as a completed migration.
* The design draws on prior _real_ use of `beads` (`bd`) in vp-beads — the
  product decisions are informed by lived experience with a predecessor, which
  is a legitimate claim.
* Repo documents: `README.md`, `VISION.md`, `ROADMAP.md`, `BRAND.md`,
  `CONTRIBUTING.md`, and fifteen decision records under `.diarium/decisions/`.
* Brand assets: `brand/diarie-mark.svg`, `diarie-lockup.svg`,
  `diarie-favicon.svg`, `og.png`, plus `tokens.css` / `tokens.json` and
  `brand-book.html`.
* Measured on diarie.dev (2026-07-29): axe-core 4.12.1 reports **0 violations**,
  CLS **0**, and every text and UI contrast pair passes WCAG AA — the published
  contrast table in BRAND.md is computed, not asserted.
* The legacy-store path is verified against a real store rather than a fixture:
  pointed at `../vp-beads`, both `ready` and `validate` exit 1 with `ENOSTORE`
  and a paste-ready `git mv` carrying absolute paths on both sides (2026-07-29).
  The behaviour diarie.dev documents is the behaviour observed.

**Absent — future work must NOT fabricate these:** there are no external users,
testimonials, case studies, customer logos, benchmarks, adoption or download
figures, uptime or scale numbers, and no third-party endorsement of any kind.
Planned dogfooding beyond these two repos is intent, not evidence. This absence
is the reason the anti-references ban stars-counter theatre and "trusted by"
walls: there is nothing true to put there, and inventing it would forfeit
exactly the credibility the project trades on.

## Product Principles

1. **Leaving must always be free.** Every decision is measured against whether
   it makes the store harder to walk away from. A feature that needs a daemon, a
   lock, or ownership of the user's data is out of scope by construction.
2. **The CLI reads; the editor writes.** No `add`, `close`, or `assign`. A CRUD
   layer would make diarie the owner of the data, and the point is that the user
   owns it.
3. **Degrade loudly, never silently.** A missing store is an error, not an empty
   backlog; a malformed row is represented, never dropped. Anything a caller
   must not miss goes to stdout and shows up in the exit code.
4. **Computed, never stored.** Derived state (ready, blocked) is a pure function
   of the dependency graph, so it cannot go stale and cannot be forgotten.
5. **A refusal is a position, not a gap.** Non-goals are stated as identity and
   carry a named revival trigger — reopened only against a changed argument,
   never talked back in by convenience.

## Accessibility & Inclusion

* **WCAG 2.x AA, verified, with APCA as the stricter cross-check.** Every text
  token's contrast ratio is measured and recorded in [BRAND.md](./BRAND.md);
  where WCAG and APCA disagree, APCA wins. Size-restricted tokens (`hektograf`
  on `arkiv` at Lc −22; `stämpel-ljus` at Lc −46) are held to their documented
  uses — borders/display and short labels respectively, never paragraphs.
* **Reduced motion is full parity**, not a degraded fallback:
  `prefers-reduced-motion` gets the complete page rendered at once — the same
  information, calm.
* **Color is annotation, never the message.** Meaning is never carried by hue
  alone; in the CLI, `NO_COLOR` and non-TTY output lose no information.
* **Privacy is an accessibility stance.** Self-hosted fonts with
  `font-display: swap`, no CDN, no tracking, no cookies, no consent banner —
  nothing to consent to.
