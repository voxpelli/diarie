---
version: alpha
name: diarie
description: >-
  The visual identity of diarie — a flat-YAML task tracker that is just
  files. Registry honesty (diarium), herbarium warmth, stepped light.
colors:
  arkiv: "#171126"
  yta: "#1F1733"
  yta-2: "#2A1F45"
  lysning-1: "#221940"
  lysning-2: "#2E2257"
  lysning-3: "#3C2D6E"
  lysning-4: "#4B3A87"
  papper: "#EFE6D2"
  lavendel: "#B7ABDD"
  hektograf-ljus: "#9C90C4"
  hektograf: "#6B4FC8"
  fosfor: "#5CE49A"
  barnsten: "#E8A13C"
  stampel: "#D8453E"
  stampel-ljus: "#E8756B"
  stampel-mork: "#A83732"
  kant: "rgba(239, 230, 210, 0.16)"
  markering: "rgba(107, 79, 200, 0.42)"
  fosfor-p3: "oklch(82.5% 0.207 156.3)"
  barnsten-p3: "oklch(76.1% 0.171 71.8)"
  stampel-p3: "oklch(59.9% 0.218 27)"
  stampel-ljus-p3: "oklch(69.3% 0.17 26.6)"
  lysning-4-p3: "oklch(40.9% 0.154 290)"
typography:
  ordmarke:
    fontFamily: Fraunces
    fontSize: 88px
    fontWeight: 520
    lineHeight: 1
    fontVariation: '"opsz" 144, "wght" 520, "SOFT" 60, "WONK" 1'
  rubrik:
    fontFamily: Fraunces
    fontSize: 34px
    fontWeight: 480
    lineHeight: 1.15
    fontVariation: '"opsz" 72, "wght" 480, "SOFT" 40, "WONK" 1'
  brodtext:
    fontFamily: 'Fraunces, "Fraunces Fallback", Georgia, serif'
    fontSize: 17px
    fontWeight: 415
    lineHeight: 1.65
    letterSpacing: 0.005em
    fontVariation: '"opsz" 15, "wght" 415, "SOFT" 0, "WONK" 0'
  lasare:
    fontFamily: Fragment Mono
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.7
  lasare-detalj:
    fontFamily: Fragment Mono
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: 0.1em
  hero:
    fontFamily: Fraunces
    fontSize: 5.6rem
    fontWeight: 520
    lineHeight: 1
    letterSpacing: -0.012em
    fontVariation: '"opsz" 144, "wght" 520, "SOFT" 60, "WONK" 1'
  rubrik-fluid:
    fontFamily: Fraunces
    fontSize: 2.3rem
    fontWeight: 480
    lineHeight: 1.15
    letterSpacing: -0.006em
    fontVariation: '"opsz" 72, "wght" 480, "SOFT" 40, "WONK" 1'
  ingress:
    fontFamily: Fraunces
    fontSize: 1.6rem
    fontWeight: 440
    lineHeight: 1.35
    letterSpacing: -0.004em
    fontVariation: '"opsz" 40, "wght" 440, "SOFT" 40, "WONK" 0'
  mellanrubrik:
    fontFamily: Fraunces
    fontSize: 1.3rem
    fontWeight: 500
    lineHeight: 1.25
    fontVariation: '"opsz" 40, "wght" 500, "SOFT" 40, "WONK" 0'
  brodtext-liten:
    fontFamily: Fraunces
    fontSize: 0.95rem
    fontWeight: 415
    lineHeight: 1.65
  lasare-liten:
    fontFamily: Fragment Mono
    fontSize: 0.8rem
    fontWeight: 400
    lineHeight: 1.7
  ordmarke-liten:
    fontFamily: Fraunces
    fontSize: 1.15rem
    fontWeight: 500
    lineHeight: 1
    fontVariation: '"opsz" 40, "wght" 500, "SOFT" 60, "WONK" 1'
  scale:
    hero-min: 3.4rem
    rubrik-fluid-min: 1.7rem
    ingress-min: 1.25rem
    exit-numeral: 4.2rem
rounded:
  xs: 3px
  sm: 4px
  md: 6px
spacing:
  '3xs': 0.5rem
  '2xs': 0.7rem
  xs: 0.9rem
  sm: 1rem
  'sm-plus': 1.1rem
  compact: 1.2rem
  md: 1.4rem
  'md-plus': 2rem
  lg: 2.4rem
  'lg-plus': 2.6rem
  xl: 4.5rem
components:
  term:
    backgroundColor: "{colors.yta-2}"
    textColor: "{colors.papper}"
    rounded: "{rounded.md}"
    typography: "{typography.lasare}"
    padding: 1.1rem
  term-wrapped:
    backgroundColor: "{colors.yta-2}"
    textColor: "{colors.papper}"
    rounded: "{rounded.md}"
    typography: "{typography.lasare}"
    padding: 1.1rem
  specimen-sheet:
    backgroundColor: "{colors.papper}"
    textColor: "{colors.arkiv}"
    rounded: "{rounded.md}"
    padding: 1.4rem
  install:
    backgroundColor: "{colors.yta-2}"
    textColor: "{colors.papper}"
    rounded: "{rounded.md}"
    typography: "{typography.lasare}"
  install-button:
    backgroundColor: "{colors.fosfor}"
    textColor: "{colors.arkiv}"
    rounded: "{rounded.sm}"
    typography: "{typography.lasare}"
  marker-wash:
    backgroundColor: "{colors.markering}"
    textColor: "{colors.papper}"
    rounded: "{rounded.xs}"
  stamp-dnr:
    textColor: "{colors.stampel-ljus}"
    typography: "{typography.lasare-detalj}"
  exit-card:
    backgroundColor: "{colors.yta}"
    textColor: "{colors.lavendel}"
    rounded: "{rounded.md}"
    padding: 1.3rem
---

# diarie — DESIGN.md

_Agent-facing projection of the diarie identity. Canonical sources are
[`tokens.css`](./tokens.css) (values), [`BRAND.md`](../BRAND.md) (rationale),
and the SVG files (geometry); when this file and those disagree, those win.
Implementation contract for the built pages: [`HANDOFF.md`](./HANDOFF.md). Border colors are outside
the component schema: hairlines are always `kant` at 0.5px, stamp borders
always `stampel` (dark ground) or `stampel-mork` (paper) at 1.5px.
Lint: `npx @google/design.md lint DESIGN.md` — current status: 0 errors,
20 accepted warnings, all `orphaned-tokens` (palette members referenced by
the page ground, halo, borders, and terminal states rather than by schema
components — including the five `*-p3` tokens, consumed by a media gate
rather than a component — plus the four `typography.scale` steps, which are
an enumerated ramp by definition and so reference no component). The two
linters want different things and both are satisfied: this one rejects a
`clamp()` in `fontSize`, while Impeccable's detector reads a fluid role's
endpoints, so the fluid minima live in `scale` and the maxima in the roles._

## Overview

diarie is a task tracker that is just files — no daemon, no database, the
CLI a reader over YAML the user's editor writes. The identity holds one
anchor and two motifs. Anchor: the **diarium**, the Swedish public
registry — every record numbered, findable, never hidden. Motifs: the
**herbarium** (Linné's specimen sheets: 280-year-old plain files; the
pressed twinflower mark) and **genomlysning** (the archivist's light table;
in Swedish also the word for scrutiny — the halo is backlighting, not aura).

The register is honest, so the design is honest: consequences are named,
contrast ratios are computed and published, costs are stated with their
revival triggers. Any visual decision that cannot be traced to the anchor,
a motif, or an invariant in VISION.md does not belong in the system.

## Colors

Names are Swedish, ASCII-folded: _arkiv_ archive (page ground), _yta_
surface, _lysning_ the stepped backlight (four flat steps, outer → inner,
never a gradient), _papper_ herbarium paper, _hektograf_ the violet
copy-ink of the analog office, _fosfor_ terminal phosphor, _bärnsten_
amber, _stämpel_ stamp red.

**The highlights have jobs — this is the load-bearing rule.** The accents
are the CLI's exit-code contract: `fosfor` is exit 0 and `ready`, and
speaks only for the terminal — never decorative, never where it could be
mistaken for "workable". `barnsten` is exit 1 (asked wrong; stale claims).
`stampel` is exit 2 — the rejection stamp belongs to `validate`. Blocked
is `lavendel`: waiting, not wrong.

Contrast is verified in both models (WCAG 2.x and APCA-W3); the full table
lives in BRAND.md. Follow APCA where they disagree: `hektograf` on arkiv
(Lc −22) is borders and decoration only, even at display sizes;
`stampel-ljus` (Lc −46) carries short status labels, not paragraphs; on
papper use `stampel-mork`. Body text on arkiv is `papper` (primary),
`lavendel` (secondary), `hektograf-ljus` (muted). On P3 screens the
highlights upgrade to the `*-p3` tokens above — chroma-boosted OKLCH with
lightness and hue held, so every ratio survives. Serve them only under the
double gate (`color-gamut: p3` + `@supports oklch`), which lives in
tokens.css; the token values here are the what, the gate is the when.

## Typography

Two voices, no third, because the architecture has exactly two sides: the
**archive voice** is Fraunces — what the human wrote — and the **reader
voice** is Fragment Mono — what the CLI reports. The split is semantic: on
any surface addressing both audiences, human-facing prose is serif and
machine-facing content (commands, output, codes, the agents card) is mono.

Fraunces is variable; the cuts are tokens. `ordmarke` (opsz 144, WONK 1)
is the identity cut — wordmark and hero only, at 40px and above. `rubrik`
keeps the wonk for headings. `brodtext` turns wonk and softness off:
character belongs at display sizes, never in running text.

**The named cuts are axis settings, not the whole ramp.** They fix the
variable-font coordinates at a reference size; the built page then resolves
them into three fluid display roles — `hero`, `rubrik-fluid`, `ingress` —
plus `mellanrubrik` (1.3rem, the one card-heading cut, replacing three
near-identical one-offs that separated by weight alone), `ordmarke-liten`
(1.15rem, the header wordmark — the one place `WONK 1` is legitimate below
25.6px, because a wordmark is not running text), and two reused reading
steps, `brodtext-liten` (0.95rem, the single small-prose size on the page)
and `lasare-liten` (0.8rem, terminal and footer fine print). Those twelve
entries are the ramp. Anything else on a built page is a one-off and should
be justified or folded into a role.

**Emphasis lifts weight, nothing else.** Inline emphasis inside running text
moves `wght` and, where the stroke needs warming, `SOFT` — never `opsz`,
which belongs to the size the type is set at. A `<strong>` is not a new cut.

**Tracking is tuned for light-on-dark.** Light type on a dark ground blooms,
so display sizes carry negative tracking (`hero` −0.012em, `rubrik-fluid`
−0.006em, `ingress` −0.004em) and text size carries a touch of positive
(`brodtext` +0.005em). Mono is always zero — `code`, `pre`, `kbd` and `term`
reset it so no column can drift. The floor is −0.04em.

**The front matter cannot hold a `clamp()`** — the spec's `fontSize` takes a
single dimension, and a range is a lint error. So each fluid role records
its **maximum** there, and the real fluid range lives in the sidecar's
`typographyMeta`, next to the token it belongs to:

| Role           | Fluid range as shipped          |
| -------------- | ------------------------------- |
| `hero`         | `clamp(3.4rem, 9vw, 5.6rem)`    |
| `rubrik-fluid` | `clamp(1.7rem, 3.4vw, 2.3rem)`  |
| `ingress`      | `clamp(1.25rem, 2.6vw, 1.6rem)` |

**The Reference-Size Rule.** A token's `fontSize` is where its axis settings
were chosen or where the role tops out — not a size you must ship literally.
Read a cut as "these axes at about this size"; ship the fluid role when the
type has to survive a viewport.

Fonts are always self-hosted (both OFL, no Reserved Font Names — subsetting
needs attribution only). On the site they are subset and served from `fonts/` beside the page —
the same files the release tooling reads — preloaded, with
`font-display: swap`.

The serif stack carries a metric-adjusted alias, `"Fraunces Fallback"`
(`local("Georgia")`, `size-adjust: 105.7%`). It is **not a third typeface** —
it is the system serif already at the end of the stack, corrected so
`font-display: swap` no longer reflows prose by 5.4% when Fraunces arrives.
Measured residual after the override: 0.6%.

## Layout

One centered column, `max-width: 66rem`, `1.4rem` side padding. Vertical
rhythm in rem: `1rem` grid gaps, `1.4rem` component padding, `2.4rem`–`2.6rem`
column gaps, `4.5rem` section padding. Breakpoints:
below **840px** multi-column grids collapse to one or two columns; below
**540px** everything is single-column and sections tighten to `3.2rem`.
The scene recurs between chapters via the leaf rule; the light table
appears at full strength only in the hero and faintly behind the footer
stamp — the lamp left on.

**Four role tokens, seven component steps.** `sm` / `md` / `lg` / `xl` name
the four structural roles above and are normative for them. Component
interiors legitimately need the steps between, and the front matter now
carries the ones the page actually reuses — `3xs` 0.5, `2xs` 0.7, `xs` 0.9,
`sm-plus` 1.1, `compact` 1.2, `md-plus` 2, `lg-plus` 2.6. Measured on the
built page, `1.1rem` is the single most-used interior value after `1rem`;
`lg` (2.4rem) is the least-used token in the set. Values outside these
eleven are one-offs, and a new one should earn its place or snap to a step.

**The Measure Rule.** Running prose is capped by one class, not by inline
widths: `.measure` (34rem) and its
centred twin `.measure-c`. Never author a per-paragraph `max-width` — a page
that does drifts, and this one had eleven inline widths across three
different values before they were consolidated.

**Do not measure a measure with `ch`.** 44rem was recorded here as "64ch"; it was
never that — `ch` is the advance of `0`, and counting real glyphs put the same
measure far above the 65–75 guide, which is why it is now 34rem.
`ch` is the advance of `0`, which is 11.05px in Fraunces at `opsz 15 / wght 415`
while a mean prose character is \~7.5px — it under-reports by \~45%. Fraunces
compounds it: an x-height of 0.436em makes 17px read optically like \~15.4px
Georgia, so a long line arrives at a small apparent size on a dark ground.
The measure is now **34rem** (544px), down from 44rem (704px). A cap that does
not follow its font size is a broken cap, so `.lineage p` (15.2px) takes its own
30rem and `footer .fine` (12.8px mono) takes 36rem — the latter sized so the
footer's two-up composition survives, with 251px between the fine print and the
184px dnr stamp at 1440px.

**Record the width, not the character count.** Characters-per-line is a derived
figure and its value depends on a choice nobody writes down: counting the _top_
line of these paragraphs gives 59–69, counting the _longest_ gives 66–87, and
the CSS `ch` unit gives 64 — three different answers for one measure, none of
them wrong. Widths in rem are unambiguous and re-checkable; treat 65–75
characters as the guide that set the width, never as a figure to assert.

## Elevation & Depth

The system is flat; depth is light, not shadow. The only permitted shadow
is the specimen sheet's mounting ring (`box-shadow: 0 0 0 6px` in
`lysning-2` — paper pressed onto the table). All other depth comes from
stepped light (concentric flat circles in the lysning ramp, at any scale)
and surface steps (arkiv → yta → yta-2). A static risograph grain covers
the dark ground at 4% opacity (`--korn`) — texture, never animated.

Because depth is light rather than shadow, the only true stacking order is
the atmosphere, and it is named rather than guessed: `--z-bakom` (−1, the lit
scene and the stamp's discs, behind the page), `--z-korn` (60, the grain,
above all content), `--z-ledger` (70, the reading-progress rule, above the
grain). Three values, one direction. A bare integer in a `z-index` is a bug.

## Shapes

Corners are `6px` on cards and terminals, `3px` on the marker wash;
borders are `0.5px` hairlines in `kant`. Stamps are the sharp exception:
`1.5px` borders, rotated a few degrees off true (−4° to −7°), dashed for
`granskad`, solid with an inner rule for the `INKOM` date stamp. On the
built pages both are outlined SVG — rotation baked into geometry, immune
to per-glyph pixel snapping — and at or below 1.4 dppx the remaining
rotated HTML text straightens, triggered by resolution (a capability),
never by vendor sniffing. The mark's
bells are deliberately asymmetric — pressed specimens are never symmetric —
and the halo is always four flat steps.

## Components

The built vocabulary, with token bindings in the front matter: **term**
(terminal block; phosphor for commands and exit-0 output, lavendel for
structure, amber for staleness, stämpel-ljus for errors; `role="img"` with
a summarizing `aria-label` per WCAG H86); **specimen-sheet** (paper card,
tilted −0.8°, tape corners, optional `granskad` stamp; YAML with hektograf
keys); **install** (mono pill with copy button — the button is the page's
only solid-fosfor element and never animates); **marker-wash** (emphasis, at most
three per page — borderless ink with hand-uneven corners, deliberately
distinct from the bordered, square-cornered code chip); **stamp-dnr** (`INKOM <date>` over `dnr <version>`; site footer and release notes only); **exit-card** (oversized
`ordmarke`-cut numeral colored by exit code); the **leaf rule** (hairline
with the mark's opposite leaf-pair). Full states, motion timings, and edge
cases: HANDOFF.md.

**Terminal ink is five classes, and shipping four is a silent loss.** `.c`
prompt and comment (`hektograf-ljus`), `.g` phosphor (`fosfor`), `.k`
structure (`lavendel`), `.a` staleness (`barnsten`), `.r` error
(`stampel-ljus`). The set is not decorative — it is the exit-code contract
rendered — so an incomplete set costs a semantic role rather than a colour.
The built page once carried only four, and the missing `.a` left amber with
a single appearance on the whole surface.

**The reader voice has no italic.** Fragment Mono ships a single `normal` face
and `code,pre,kbd` set `font-synthesis: none`, so a synthetic oblique is never
drawn. `font-style: italic` inside a mono run is a silent no-op — the specimen
sheet carried one on `.y-c` for weeks and rendered upright throughout. Colour
alone marks a comment there. Do not re-add it.

**term-wrapped** is `term` with `white-space: pre-wrap`. Use it when the
block's content is prose-shaped — a long error string — rather than
column-aligned. `diarie` pads no columns (fields are single-space
separated), so a wrap costs no alignment, and wrapping beats hiding the
half of a message that names the fix behind a horizontal scroll.

**The second surface.** This system has two targets, not one. Beyond the
pages, the CLI's own terminal output is a first-class surface of the same
tokens — ready rows in `fosfor`, stale claims in `barnsten`, `validate`
findings in `stampel`, structure in `lavendel`, with `NO_COLOR` and non-TTY
output losing no information. It is specified in [`BRAND.md`](../BRAND.md)
and not yet built. Until it is, a coloured terminal block on a page is an
illustration of the token contract, not a screenshot of the tool.

## Do's and Don'ts

Do: stepped light at any scale; static grain up to 5%; name the
consequence, not the adjective; lowercase `diarie` always; consequences
with revival triggers; mono for anything a machine said; cap running prose
with `.measure`; name every `z-index` from the three-value scale.

**Do paste CLI output verbatim.** Every terminal block on a brand surface is
a claim about the tool's contract, and no gate checks it. Generate the text
by running the binary against a throwaway store, paste the bytes, and never
truncate with an ellipsis. This page has shipped a paraphrased error twice —
once wording a `--root` failure as though the store had been searched for,
which is the exact imprecision `lib/store.js` refuses in a comment.

Don't — these are identity, not preference: no gradient glow (the halo is
stepped or it is not the halo); no mascot (the twinflower is a specimen —
it does not wave or wear a hard hat during errors); no dark-pattern motion
(nothing animates on or near a call to action); no tracking, ever; no
third typeface; no second easing (`cubic-bezier(0.22, 0, 0.18, 1)` is the
only curve); no fosfor as decoration; no brand asset behind a login.
