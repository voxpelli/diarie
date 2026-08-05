# diarie — design system

<!-- SOURCE: .design-sync/bundle/README.md in the diarie repo. This file is
     uploaded verbatim by .design-sync/build.mjs and is inlined into the design
     agent's system prompt, so every sentence must be actionable without
     guessing. Edit it there, never in the Claude Design project. -->

The visual identity of **diarie**, a flat-YAML task tracker that is _just
files_. This project carries diarie's **token layer, fonts, and brand rules** —
not a component library (diarie ships a CLI, not UI components). Build diarie
surfaces by composing plain HTML/CSS against the tokens below.

Identity in one line: _diarie is a public record of your own work — pressed
flat, backlit, and honest._ Registry-honest, herbarium-warm, klarspråk-plain.

## The styling idiom: CSS custom properties

diarie has **no utility classes and no component props**. You style by reading
CSS variables — `var(--token)` — defined in `tokens/tokens.css` and reached
through `styles.css`. Everything a design needs is in the `styles.css` `@import`
closure: link `styles.css` and you have the tokens, both fonts, and an on-brand
base (dark ground, archive-voice type, semantic link color).

### Setup: the ground is dark; `.pa-papper` is the only theme switch

The default surface is the dark **archive** ground (`--arkiv`). For a light
"herbarium paper" surface — cards, the brand book, print — put
`class="pa-papper"` on a container. That class flips the role tokens (`--grund`,
`--text`, `--text-2/3`, `--lank`, `--kant`) and the paper-safe accents
(`--status-attention`, `--exit-2`). It is the token-system equivalent of a theme
provider: nest it on any subtree. There is no dark/light media query — dark is
the identity, paper is a deliberate local context.

```html
<body>                          <!-- dark archive ground, by default -->
  <article class="pa-papper">   <!-- a herbarium paper specimen sheet -->
    <h3>Row #diarie-7</h3>
    <p>Roles flip: ink on paper, hektograf links.</p>
  </article>
</body>
```

## The load-bearing rule: accents are the exit-code contract

This is the one rule that keeps the palette from being a mood board. **The
intense accents are the CLI's exit-code contract, in color. Each has a job; none
is decorative.**

| token                                        | is                                                                                                    | use for                                                                                                                                                  |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--fosfor` / `--exit-0` / `--status-ready`   | exit 0 — the answer, on stdout                                                                        | terminal output, `ready` rows, links (`--lank`). **Never** decorative — never where it could read as "this is workable."                                 |
| `--barnsten` / `--exit-1` / `--status-stale` | exit 1 — you asked wrong (ENOSTORE, EUSAGE, EEXIST, … — the set lives in lib/schema.js); stale claims | warnings, staleness — correctable, not condemned                                                                                                         |
| `--stampel` / `--exit-2`                     | exit 2 — it ran, the answer is no                                                                     | the rejection stamp; belongs to `validate`. Large type / stamps only on dark (use `--stampel-ljus` for body-size red on dark, `--stampel-mork` on paper) |
| `--status-blocked` (= `--lavendel`)          | waiting, not wrong                                                                                    | blocked rows                                                                                                                                             |

If a color on the page isn't carrying one of these meanings, it should be a
neutral (ground/surface/text/ink), not an accent.

## Two greens, and they are not a ramp

The single easiest way to misuse this palette.

* **`--fosfor` is emitted light** — terminal phosphor on the dark ground. It
  carries the exit-0 contract. At 1.30:1 on `--papper` it is unusable as ink.
* **`--blad` is reflected light** — a pressed specimen for paper contexts,
  running `--blad-blek` → `--blad-ljus` → `--blad` → `--blad-mork`.

**Never substitute one for the other**, and never reach for `--fosfor` where a
reader could mistake it for "ready". They differ in **chroma, not hue** (\~20°
apart in OKLCH), so hue will not separate them.

## The token vocabulary (all defined in `tokens/tokens.css`)

**Use the role tokens for page chrome; reach for raw palette names only for
specimen/brand work.**

* **Page roles (prefer these):** `--grund` (ground), `--text` / `--text-2` /
  `--text-3` (primary/secondary/muted), `--lank` (links), `--kant` (hairline
  border color).
* **Grounds & surfaces (raw):** `--arkiv` (page), `--yta` (cards), `--yta-2`
  (code/terminals).
* **The halo — stepped light, never a gradient:** `--lysning-1` … `--lysning-4`
  (outer → inner). Four flat steps at any scale; a gradient is _not_ the halo.
* **Paper & ink (raw):** `--papper` (herbarium paper / text on dark),
  `--papper-2` (a lifted sheet), `--hektograf` (violet copy-ink — borders,
  display, body-on-paper), `--hektograf-ljus` (muted), `--lavendel`
  (secondary), `--lavendel-ljus` (selection on paper).
* **Paper-context tints** — only meaningful inside `.pa-papper`:
  `--blad-blek` / `--blad-ljus` (endorsement card ground + hairline),
  `--stampel-blek` / `--stampel-dov` (refusal card ground + hairline),
  with `--blad-mork` / `--stampel-mork` as their ink. **Both hairlines measure
  below the 3:1 non-text floor, so a tint may never be the only thing
  identifying a card — put the state in the label.**
* **Type — two voices, no third:** `--stil-arkiv` (Fraunces, the archive voice —
  human-written prose), `--stil-lasare` (Fragment Mono, the reader voice —
  anything a machine said: commands, output, codes). Fraunces cuts, applied via
  `font-variation-settings`: `--snitt-ordmarke` (wordmark/hero only, ≥40px),
  `--snitt-rubrik` (headings), `--snitt-brodtext` (running text — wonk off).
  `--stil-arkiv` also names `"Fraunces Fallback"` — not a third typeface but a
  metric-adjusted alias for the system serif, declared in `styles.css`.
* **Shape & motion:** `--radie` (6px card/terminal corners), `--hallinje` (the
  0.5px hairline WIDTH — pair it with the `--kant` colour above),
  `--markering` (the marker-wash highlight — at most three per page),
  `--korn` (≤5% riso grain, static — never animated),
  `--ease-lysning` (the _only_ easing — `cubic-bezier(.22,0,.18,1)`),
  `--dur-mikro` / `--dur-beat` / `--dur-reveal`.
* **Stacking:** `--z-bakom` / `--z-korn` / `--z-ledger`. Never a bare integer.

## Where the truth lives

* `tokens/tokens.css` — the authoritative values (the brand, as CSS). Read it
  before styling.
* `tokens/tokens.json` — the same values in W3C Design Tokens (DTCG) format, for
  tooling.
* `styles.css` — the entry: `@import`s the tokens, binds the fonts, sets the
  on-brand base.
* `guidelines/identity.md` — the anchor/motifs, the voice (klarspråk), and the
  refusals. Read it before writing copy.
* `components/foundations/Foundations/Foundations.html` — the specimen sheet:
  the palette, the halo, the exit-code accents, the type cuts and the
  `.pa-papper` flip, rendered. It does not show every token — notably not the
  `--blad-*` family, so read tokens.css for those.

## The refusals (these are identity, not preference)

No gradient glow (the halo is stepped or it is not the halo). No mascot (the
twinflower is a specimen, not a character). No dark-pattern motion — nothing
animates on or near a call to action. No third typeface, no second easing, no
off-token colors. `diarie` is always lowercase. Name the consequence, not the
adjective; no superlatives (_blazing, seamless, powerful, supercharge, simply,
just_, "Unlock…" are banned).
