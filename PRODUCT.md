# Product

## Register

brand

## Users

Solo developers who keep a backlog *in* their repo — and the AI agents that
share that backlog with them. Their context is a git working tree, an editor,
and a terminal; their scar is a tracker that became a migration project. They
are distrustful of lock-in and fluent in local-first / indieweb values.

The brand surface (diarie.dev, the `brand/` pages) speaks to the skeptical
arrival: someone who reads "another task tracker?" and expects to be sold to.
The page's job is to earn trust in under a screen from a reader who will judge
the argument by whether the artifact making it is honest.

## Product Purpose

diarie is a flat-YAML task tracker that is *just files*: the CLI reads a backlog
your editor writes, and refuses to misrepresent itself. It exists to fix one
class of bug — **a tracker that cannot find its store must never look like an
empty backlog.** Git is the database; leaving is free; uninstall it and the
backlog is still there.

diarie.dev exists to make that argument *credibly*, not loudly. Success is a
developer trusting diarie with a real backlog because the page itself
demonstrated the ethos: one static document, zero external requests, view-source
honest, no tracking, survives `curl` / `file://` / the Internet Archive. The
medium is the proof.

## Brand Personality

Three words: **registry-honest, herbarium-warm, klarspråk-plain.**

The voice is *klarspråk* — cared-for, simple, comprehensible (Språklagen
2009:600 §11), the register of a Swedish myndighet's registry at its best. It
names the consequence, not the adjective ("invalid priority `urgent` — it will
be treated as `medium`", never "invalid input"). The refusal is part of the
product: say no plainly, give the reason, name the revival trigger, never
apologize for a design decision. No superlatives. `diarie` is always lowercase —
it is a command, not a company. The tool is never anthropomorphized past its one
licensed phrase: *the reader is honest.* Swedish is seasoning, glossed on first
use — never a gatekeeping handshake.

The emotional target is **calm confidence**, not delight or urgency — the
smallest possible claim on the reader's attention (calm technology). A skeptical
developer should relax, not be excited.

## Anti-references

The identity is defined as much by what it refuses. This page must NOT look or
sound like:

- **The default 2026 AI aesthetic** — dark ground + a single acid-green accent,
  full stop. diarie's palette *is* dark-with-green, so specificity has to be
  earned by everything the default lacks: paper, the stamps, stepped light,
  amber and red as full citizens, and accents that are checkable semantic claims.
  If it could read as "AI made that," it has failed.
- **SaaS landing tropes** — the hero-metric template (big number + gradient
  accent), identical icon-heading-text card grids, a tracked uppercase eyebrow
  above every section, stars-counter theater, "trusted by" logo walls.
- **Marketing vocabulary** — *blazing, seamless, powerful, supercharge,
  game-changing, simply, just* (the adverb), and any sentence beginning
  "Unlock". Any sentence that would survive unchanged on a generic SaaS page is
  wrong.
- **Decorative effects** — gradient text, gradient glow (the halo is *stepped*
  risograph light, never lens flare), glassmorphism as default, side-stripe
  accent borders, a mascot (the twinflower is a specimen, not a character).
- **Dark-pattern motion** — pulsing CTAs, fake urgency, confetti at the moment
  of a decision. Motion never leans on a choice.
- **Anything that betrays the thesis** — tracking, cookies, a consent banner, a
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

## Accessibility & Inclusion

- **WCAG 2.x AA, verified, with APCA as the stricter cross-check.** Every text
  token's contrast ratio is measured and recorded in [BRAND.md](./BRAND.md);
  where WCAG and APCA disagree, APCA wins. Size-restricted tokens (`hektograf`
  on `arkiv` at Lc −22; `stämpel-ljus` at Lc −46) are held to their documented
  uses — borders/display and short labels respectively, never paragraphs.
- **Reduced motion is full parity**, not a degraded fallback:
  `prefers-reduced-motion` gets the complete page rendered at once — the same
  information, calm.
- **Color is annotation, never the message.** Meaning is never carried by hue
  alone; in the CLI, `NO_COLOR` and non-TTY output lose no information.
- **Privacy is an accessibility stance.** Self-hosted fonts with
  `font-display: swap`, no CDN, no tracking, no cookies, no consent banner —
  nothing to consent to.
