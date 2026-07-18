# Handoff Spec: diarie.dev + brand-book.html

*Implementation contract for the two built pages. Token values:
[`tokens.css`](./tokens.css) / [`DESIGN.md`](./DESIGN.md). Rationale:
[`BRAND.md`](../BRAND.md). Both pages are single static HTML files with
fonts inlined; there is no build step to run in production — the reference
implementation is the spec's executable form, and this document is what
must survive any rewrite.*

## Overview

`index.html` is diarie.dev: dark ground (the light table), one screen of
hero followed by nine sections, two motion beats, zero external requests.
`brand-book.html` is the paper inversion of the same system. Everything
below applies to index.html unless marked *(book)*.

## Layout

| Property | Value |
|---|---|
| Content column | `max-width: 66rem`, centered, `0 1.4rem` padding (book: 60rem) |
| Section rhythm | `4.5rem 0` vertical padding; `3.2rem` below 540px |
| Section order | hero → the record is yours → who it is for → the write side → ⁂ → taxonomy → library → ⁂ → the contract → ⁂ → the refusals → ⁂ → closer → lineage → footer (⁂ = leaf rule) |
| Grids | codes/types: 3 and 4 columns; aud/qa/sheet-grid: 2 columns |

### Responsive behavior

| Breakpoint | Changes |
|---|---|
| >840px | Full layout as above |
| 541–840px | `codes`/`types` → 2 columns; `aud`, `qa`, `sheet-grid` → 1 column |
| ≤540px | Everything 1 column; sections `3.2rem`; nav gap tightens |

No layout uses fixed heights; all containers grow with content (long
translations must not clip — see Edge cases).

## Design tokens used

All colors, type cuts, radii, and durations come from `tokens.css` — no
literal values in components except the environmental ring tints
(`#191330`, `#1C1536`, `#1F183C`), which sit between `arkiv` and
`lysning-1` and are page-scoped atmosphere, not palette members.

| Token | Usage on these pages |
|---|---|
| `--stil-arkiv` + cuts | h1 (`ordmarke`), h2 (`rubrik`), body (`brodtext`), exit-card numerals (`ordmarke` at 4.2rem) |
| `--stil-lasare` | nav, eyebrows, terminals, agents card, stamps, footer fine print |
| `--markering` | `.hl` marker wash — exactly 3 instances (why-fact 1, write-side, closer) |
| `--ease-lysning` | every transition and animation; no other curve exists |
| `--korn` | grain overlay opacity (0.04) |

## Components

| Component | Variant/props | Notes |
|---|---|---|
| `.mark` hero SVG | halo ×4 + `.flower` group | `transform-box: fill-box` required for per-circle scaling |
| `.env` | 3 giant arcs, center above the viewport | `aria-hidden`, `z-index:-1`; full-bleed within `.hero` — every visible cut lands on a natural screen edge, never a column edge |
| `.install` | hero + closer instances | JS binds every `.install`; button = only solid-fosfor element |
| `.term` | role="img" + aria-label | Summarize the content in the label (WCAG H86); never leave it off |
| `.sheet` | tape ::before/::after, `.granskad` | Tilt −0.8°; granskad is an outlined-SVG flex member of the label row, centered against the catalog lines; ring shadow `0 0 0 6px lysning-2` |
| `.stamp` (refusals) | `--r` rotation, `--d` delay | Six items; dashed stämpel |
| `.dnr` in `.dnr-scene` | INKOM date stamp, **outlined SVG** | Rotation is baked into the geometry — immune to per-glyph pixel snapping (Bugzilla 492214). Colors route via `--st-line`/`--st-text`. Two complete rings behind, sized to fit — the no-clipped-arcs rule applies here too |
| rotated text | — | Decorative stamps are outlined SVG (geometry cannot stair-step); the refusal stamps and sheet stay real HTML text with `text-rendering: geometricPrecision` — which field-testing showed does **not** defeat per-glyph snapping, so `@media (max-resolution: 1.4dppx)` straightens them on low-density screens in every engine. The trigger is a capability (resolution), never a vendor — no browser sniffing. The SVG stamps and tape keep their tilt on those screens, preserving the register |
| `.leafrule` | between section pairs | `aria-hidden`; ornament background matches `arkiv` to mask the rule |
| `.hl` | inline span | Never inside headings; max 3/page |
| `code` (inline) | chip: `yta-2` + inset hairline, 2px corners | An object with edges. Exempt inside `pre` blocks and the install pill — no double boxing |
| ink vs. object | — | The wash is borderless ink with uneven corners; code is a bordered square-cornered surface. If the two are confusable, one of them is styled wrong |

## States and interactions

| Element | State | Behavior |
|---|---|---|
| Links | hover | color → `papper` (dark) / `arkiv` (book); underline persists |
| Any focusable | `:focus-visible` | 2px `fosfor` outline, 3px offset (book: `hektograf`) |
| Copy button | default → click | Clipboard write; label swaps to "copied" for 1600ms — text change only, no motion |
| Copy button | clipboard denied | Fallback: select the command text via Range so manual copy works |
| Install command | any | Never animates, never pulses — hard rule |
| Type-specimen sliders *(book)* | input | Update `font-variation-settings` live; native range = keyboard operable |

## Animation / motion

Beat 1 (hero, load) and beat 2 (refusal stamps, scroll) are the page's
entire motion budget. All animation is gated behind
`@media (prefers-reduced-motion: no-preference)` **and** the `.anim` class
set by the head script; without either, everything renders complete and
static — full information parity, not a degraded page.

| Element | Trigger | Animation | Duration | Delay | Easing |
|---|---|---|---|---|---|
| `.env circle` ×3 | load | fade + settle (`lysning` keyframe: 1.09 → 0.99 → 1) | 780ms | 0/70/140ms | `--ease-lysning` |
| `.halo` ×4 | load | same | 700ms | 200/290/380/470ms | same |
| `.flower` | load | fade + 7px rise | 740ms | 580ms | same |
| `h1` | load | **transform-only** 10px rise — opacity never drops, so the LCP element paints immediately; `fill-mode: both` holds the low start through the delay (without it, the visible element snaps down when the animation begins) | 760ms | 640ms | same |
| tagline / sub | load | fade + 10px rise | 700/650ms | 880/1000ms | same |
| `.stamps .stamp` ×6 | ≥40% in viewport, once/session | press-through (`stampla`: 1.16 → 0.985 → 1) | 700ms | 0–400ms stagger | same |

Follow-through is achieved by varying *durations* across the stagger, never
by a second easing — one curve is brand law. The LCP element (`h1`) may
never be animated through opacity.

Sequence completes ≤1.8s. Stamp beat guards: `sessionStorage`
`diarie-stamps` set on first fire; if storage throws or
IntersectionObserver is absent, stamps render visible immediately.

## Progressive enhancement

Three tested tiers; every layer is additive and guarded.

| Tier | Mechanism |
|---|---|
| Baseline (iPhone 12 mini, 375px; any browser; no JS) | Fluid `clamp()` type; no fixed heights; `.install` wraps below 540px; terminals scroll rather than break; tap targets ≥ 32px (nav padding, copy button); `viewport-fit=cover` + `env(safe-area-inset-*)` on body and footer; `text-size-adjust: 100%` |
| Modern Safari (iPhone 17 Pro, iOS 26) | Display-P3 highlights via `@media (color-gamut: p3)` + `@supports oklch` — fosfor and bärnsten exceed sRGB gamut, lightness/hue preserved so ratios hold (hero halo fills route through tokens for this); `text-wrap: balance` on headings, `pretty` on prose; `text-box-trim` cap-trimming on display type |
| Desktop / Firefox at 2560×1440 | `scrollbar-color` themed both grounds; `≥1800px` root bumps to 17.5px so the column keeps presence on 27"; 0.5px hairlines render as 1px at dpr 1 — accepted |
| Bleeding edge (iOS 26.5 / 27 beta; Chromium) | Per-element `random()` rotates every refusal stamp and the specimen sheet a little differently per load — a hand never stamps twice at the same angle (fallback: the authored `--r` angles; the outlined-SVG stamps keep their baked tilt); scroll-driven ledger line (`scroll(root)` timeline) as reading progress — functional feedback, not a beat; cross-document view transitions between diarie.dev and the brand book with the mark as the shared element (`view-transition-name: diarie-mark`), eased by `--ease-lysning`, motion-guarded; `corner-shape: squircle` on cards where it exists; `hanging-punctuation` in Safari |
| Courtesy layers | `prefers-contrast: more` — stronger hairlines, muted text lifted to papper, grain off; `forced-colors: active` — decorative layers removed, system colors win; `@media print` — the page prints as a specimen sheet: paper ground, ink text, chrome hidden, link URLs printed in lineage and footer |

The brand book deliberately skips the P3 layer: its swatches must show the
exact sRGB values the hex labels claim.

## Edge cases

- **No JS**: head script never runs → no `.anim` class → fully static
  page; copy buttons present but inert (command remains selectable).
- **Reduced motion**: durations zeroed via token override + `.anim` never
  set; identical content.
- **Blocked storage/private mode**: try/catch around all storage; stamps
  degrade to always-visible.
- **Long strings / translations**: no fixed heights; `.term` and `.sheet
  pre` scroll horizontally (`overflow-x:auto`) rather than wrap code.
- **Slow connection**: single request; fonts are inline (`font-display:
  block` is safe — no network fetch can delay them). The measured cost of
  this trade is in BRAND.md; revival trigger: cold-mobile LCP > 2.5s.
- **Link previews**: `og.png` (1200×630) must be deployed at
  `https://diarie.dev/og.png` — the only sibling asset.
- **Empty/loading/error states**: none exist; the page has no data
  dependencies by design.

## Accessibility notes

- Landmarks: `header` (nav labelled "Site") → `main` → `footer`; one `h1`;
  section `h2`s in document order — focus order follows source order, no
  tabindex anywhere.
- Decorative visuals (`.env`, leaf rules, tape, `granskad`) are
  `aria-hidden`; meaningful visuals (`.mark`, terminals, `.dnr`) carry
  `role="img"` + descriptive `aria-label`.
- Contrast: every text/background pairing published in BRAND.md with WCAG
  and APCA values; follow APCA on disagreement. No body-size `stampel` on
  arkiv; no body-size `hektograf` anywhere on dark.
- `color-scheme: dark` (meta + CSS) so UA controls and scrollbars match.
- Copy buttons have `aria-label="Copy install command"`; the "copied"
  swap is text content, announced by nature of the button label change.

## Deployment

diarie.dev root = `index.html` + `og.png`. Everything else is repo
material. `brand-book.html` works from `file://` by design. At first npm
publish: update the INKOM stamp dates (index footer, book footer) and the
`dnr` version to the release, and verify the npm links resolve.
