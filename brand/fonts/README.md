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
(latin + åäö + the arrows the pages use; woff2 flavor; the italic
additionally instanced to a single static cut). Nothing was renamed —
**neither family declares a Reserved Font Name** (verified against the
upstream OFL headers), so the OFL permits modified versions under the
original names, provided the copyright notices and license accompany
them. This folder is that provision. The exact subset command lives in
BRAND.md's type chapter.

**Outlined uses.** The wordmark, `og.png`, and the SVG stamps are glyph
*outlines* baked into documents — per the OFL, documents created with the
fonts carry no license obligations. The obligations live here, with the
font software itself.
