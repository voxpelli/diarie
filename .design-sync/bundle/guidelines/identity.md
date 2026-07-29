# diarie — identity

The rationale behind the tokens. When this file and `tokens/tokens.css`
disagree, the tokens win (prose loses to the store it describes).

## One anchor, two motifs

* **Anchor — the diarium.** The Swedish public registry: every incoming and
  outgoing record numbered, findable, never hidden (_offentlighetsprincipen_,
  1766 — the world's first freedom-of-information law). It maps onto diarie's
  invariants one to one: a malformed row is represented, never silently dropped;
  git is the audit log; every task has its id, its _diarienummer_. The register
  aesthetic _is_ the ethos, not decoration on it.
* **Motif — herbarium.** Linné's specimen sheets: 280-year-old plain files —
  paper, a pressed flower, a label, a stamp, still readable, no vendor, no
  format rot. The mark is a pressed _Linnaea borealis_ (twinflower): two nodding
  bells on one forked stem — the CLI reads, your editor writes.
* **Motif — genomlysning.** Examining a sheet by backlighting it; in Swedish
  also the word for _scrutiny_. It gives the mark its halo — the light table,
  not an aura. The glow _is_ the honesty. Rendered as four flat stepped
  circles (`--lysning-1…4`), never a gradient.

## Color, in one paragraph

Dark archive ground, herbarium paper as the warm counter-surface, violet
copy-ink (`hektograf`) as the analog-office accent, and three intense
highlights that each carry a CLI exit code (see the README's load-bearing
rule). Contrast is measured and published, because the numbers are claims and
claims get checked: the brand book's palette table carries WCAG 2.x and APCA
for the core rows, while the paper-context tints so far carry WCAG ratios in
`tokens.css` only and no APCA at all (open row `diarie-apc`). Two APCA-stricter
limits to respect: `--hektograf` on the dark ground
is borders/display only (never body text on dark); `--stampel-ljus` carries
short status labels, not paragraphs. The dark-ground-plus-green look is a 2026
AI default — what makes diarie specific is everything that default lacks: the
paper, the stamps, the stepped light, amber and red as full citizens, and the
fact that every accent is a semantic claim you can check against real exit
codes.

## There are two greens, and they are not a ramp

This is the easiest way to misuse the palette, so it gets its own section.

* **`--fosfor` is emitted light** — terminal phosphor on the dark ground. It
  carries the exit-0 contract (`--exit-0`, `--status-ready`, `--lank`). At
  1.30:1 on `--papper` it is unusable as ink on the sheet.
* **`--blad` is reflected light** — a pressed specimen, for paper contexts,
  running `--blad-blek` → `--blad-ljus` → `--blad` → `--blad-mork`, palest to
  darkest.

**Never substitute one for the other.** `fosfor` must not appear anywhere a
reader could mistake it for "ready". What separates the two families is
**chroma, not hue** — in OKLCH they sit only \~20° apart, so hue will not tell
them apart, and HSL is worse than useless here (it hands the greens roughly
four times more of the hue circle than they perceptually occupy, inflating the
gap to a meaningless \~50°). `blad-ljus` is Syme's "Emerald Green" to within
ΔE00 2.88; `fosfor` is ΔE00 14.81 from that same swatch and more chromatic
than every green on Werner's chart.

## Paper contexts

`.pa-papper` flips the role tokens, and a set of tokens exists only to be used
inside that flip: `--papper-2` (a lifted sheet), `--lavendel-ljus` (selection),
the **endorsement**-card tints `--blad-blek` / `--blad-ljus`, the **refusal**-card
tints `--stampel-blek` / `--stampel-dov`, and `--blad-mork` / `--stampel-mork`
as their respective ink.

**The Tint-Is-Not-Meaning Rule.** A tinted card's tint may never be the only
thing saying which card it is. Both tinted-card borders measure below the 3:1
non-text floor (`blad-ljus` 1.66:1 on papper, `stampel-dov` 1.92:1 on papper),
so the state must live in the label — read in greyscale, or by a reader who
cannot separate the two hues, the cards must still be unambiguous.

## Type: two voices, no third

The architecture has exactly two sides, so the type does too. The **archive
voice** is Fraunces (`--stil-arkiv`): what the human wrote — old-style,
soft-serifed, a little wonky, the hand in the herbarium label. The **reader
voice** is Fragment Mono (`--stil-lasare`): what the CLI reports — plain, legible, klarspråk as a
typeface. On any surface addressing both audiences, human prose is serif and
machine content (commands, output, codes) is mono. Both fonts are self-hosted
(both OFL) — never a font CDN; a page that needs a third party to render its
own name has lost the argument diarie exists to make.

`--stil-arkiv` also names **"Fraunces Fallback"**, which is not a third
typeface: it is a metric-adjusted alias for the system serif already in the
stack, so `font-display:swap` reflows prose \~0.4% instead of \~5% when Fraunces
lands. `styles.css` declares it; nothing else needs to.

## Voice: klarspråk

Public language should be _vårdat, enkelt och begripligt_ — cared-for, simple,
comprehensible (Språklagen 2009:600 §11).

1. **Name the consequence, not the adjective.** Not "invalid priority" but
   "invalid priority `urgent` — it will be treated as `medium`."
2. **The refusal is part of the product.** Say no plainly, give the reason,
   name the revival trigger where one exists. Never apologize for a design
   decision; never hide one. Make the exit the closing line — leaving is free,
   and saying so is the brand.
3. **No superlatives.** The strongest available sentence is a plain claim:
   "That is the whole product."
4. **`diarie` is lowercase.** Always, including sentence-start — it is a
   command, not a company.
5. **Swedish is seasoning, not gatekeeping** — loanwords welcome, glossed on
   first use.
6. **Never anthropomorphize** past the one licensed phrase: _the reader is
   honest._

## Motion

Scarce, and with a job. At most three beats per page; the hero owns one. Never
on the install command or any call to action — motion that leans on a decision
is a dark pattern. One easing only: `--ease-lysning`. Reduced motion is full
parity: `prefers-reduced-motion` gets the complete page rendered at once, the
same information, calm (the tokens already zero the durations under it).

## Stacking

Three named layers, never a bare integer: `--z-bakom` (behind), `--z-korn`
(the grain), `--z-ledger` (the reading-progress rule, riding above the grain).

## The refusals (identity, not preference)

No gradient glow · no mascot · no dark-pattern motion · no tracking, ever · no
third typeface · no second easing · no off-token colors · no brand asset behind
a login. Scarcity is what makes the system legible.
