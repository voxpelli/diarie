# fonts/

The two voices of diarie, self-hosted. Both are licensed under the
**SIL Open Font License 1.1** — the full texts ship beside the files
([`Fraunces-OFL.txt`](./Fraunces-OFL.txt),
[`FragmentMono-OFL.txt`](./FragmentMono-OFL.txt)), fetched verbatim from
the upstream repositories.

| File                           | What it is                                               | Used by                                               |
| ------------------------------ | -------------------------------------------------------- | ----------------------------------------------------- |
| `Fraunces-VF.woff2`            | Fraunces variable (opsz/wght/SOFT/WONK), subset          | both pages — the archive voice                        |
| `Fraunces-Italic-static.woff2` | Fraunces italic, instanced at opsz 14 / wght 430, subset | both pages — emphasis in prose                        |
| `FragmentMono-Regular.woff2`   | Fragment Mono regular, subset                            | both pages — the reader voice                         |
| `FragmentMono-Regular.ttf`     | Fragment Mono, unsubset TTF                              | `update-stamp.js` — outlines the INKOM stamp at build |

**Provenance.** Fraunces: Undercase Type (Phaedra Charles, Flavia
Zimbardi) — github.com/undercasetype/Fraunces. Fragment Mono: Wei Huang —
github.com/weiweihuanghuang/fragment-mono. Copyright lines as embedded in
the shipped binaries: "Copyright 2020 The Fraunces Project Authors" and
"Copyright 2022 The Fragment-Mono Project Authors" (the upstream OFL
headers currently read 2018 and 2024; both statements travel with this
folder).

**What was modified.** These are subsets, produced with `pyftsubset`
(latin + åäö + the arrows and symbols the pages use; woff2 flavor; the
italic additionally instanced to a single static cut). Nothing was renamed —
**neither family declares a Reserved Font Name** (verified against the
upstream OFL headers), so the OFL permits modified versions under the
original names, provided the copyright notices and license accompany
them. This folder is that provision. BRAND.md's type chapter carries the
Fraunces command; the Fragment Mono one is:

```bash
pyftsubset FragmentMono-Regular.ttf --flavor=woff2 \
  --unicodes="U+0020-007E,U+00A0-00AC,U+00AE-00FF,U+0152-0153,U+2013-2014,U+2018-2019,U+201C-201D,U+2022,U+2026,U+2190,U+2192,U+2212,U+2248,U+2264-2265,U+25CF,U+2717" \
  --layout-features="*" --no-hinting --glyph-names
```

**A missing codepoint is invisible to `document.fonts.check()`** — the
`@font-face` rules declare `unicode-range: U+0-10FFFF`, so the check
returns true for glyphs the subset never had, and the character silently
falls back to a system font mid-run. Fragment Mono is monospaced, so the
real test is the advance width: every covered glyph measures exactly
618/1000 em (61.8 px at `font-size: 100px`). Anything else is a fallback.
Measure, don't ask:

```js
const c = document.createElement('canvas').getContext('2d');
c.font = '100px "Fragment Mono"';
[...new Set(document.documentElement.innerText.replace(/\s/g, ''))]
  .filter(ch => Math.abs(c.measureText(ch).width - 61.8) > 0.05);
```

Run it against every page in `brand/` after changing copy that introduces
a new symbol. The one known-and-accepted miss is `U+26A1` ⚡ in
`brand-book.html` — it is absent from the upstream Fragment Mono, it sits
inside a quoted parody blurb rather than a mono column, and a system emoji
is the correct rendering there.

**Outlined uses.** The wordmark, `og.png`, and the SVG stamps are glyph
_outlines_ baked into documents — per the OFL, documents created with the
fonts carry no license obligations. The obligations live here, with the
font software itself.
