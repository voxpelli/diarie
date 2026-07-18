#!/usr/bin/env node
/**
 * update-stamp.mjs — regenerate the INKOM footer stamp with the current
 * date and package version, as outlined SVG paths (no fonts at runtime,
 * no rasterizer stair-stepping — see HANDOFF.md, "rotated text").
 *
 * Usage:
 *   node update-stamp.mjs                 # today + version from package.json
 *   STAMP_DATE=2026-08-01 STAMP_VERSION=1.0.0 node update-stamp.mjs
 *
 * CI: run before deploy / in the release workflow, e.g. as an npm
 * "version" lifecycle hook so the stamp always matches the tagged release:
 *   "scripts": { "version": "node update-stamp.mjs && git add index.html brand-book.html" }
 *
 * Dependency: npm i -D opentype.js
 * (Fragment Mono is monospace, so plain glyph outlining + letter-spacing is
 * shaping-complete — no HarfBuzz needed on this side of the pipeline.)
 */
import { readFile, writeFile } from 'node:fs/promises';
import opentype from 'opentype.js';

// ---- stamp geometry: keep in sync with the values in HANDOFF.md ----------
const SIZE = 12;        // px
const TRACK = 0.08;     // em, letter-spacing
const PAD = 14;         // px, inner padding
const H = 46;           // px, rect height
const ROT = -4;         // deg, baked into the geometry
const FONT = 'fonts/FragmentMono-Regular.ttf';
const TARGETS = ['index.html', 'brand-book.html'];

const date =
  process.env.STAMP_DATE ?? new Date().toISOString().slice(0, 10);
const version =
  process.env.STAMP_VERSION ??
  JSON.parse(await readFile('package.json', 'utf8')).version;

const font = opentype.parse((await readFile(FONT)).buffer);
const shape = (text) => ({
  d: font
    .getPath(text, 0, 0, SIZE, { kerning: true, letterSpacing: TRACK })
    .toPathData(1),
  w: font.getAdvanceWidth(text, SIZE, { letterSpacing: TRACK }),
});

const l1 = shape(`INKOM ${date}`);
const l2 = shape(`dnr ${version}`);
const W = Math.round(Math.max(l1.w, l2.w) + 2 * PAD);

const svg =
  `<svg class="dnr" role="img" aria-label="Received ${date}, diarienummer ${version}" ` +
  `width="${W + 18}" height="${H + 16}" viewBox="-9 -8 ${W + 18} ${H + 16}" overflow="visible">` +
  `<g transform="rotate(${ROT} ${Math.round(W / 2)} ${Math.round(H / 2)})">` +
  `<rect x="0" y="0" width="${W}" height="${H}" fill="none" stroke="var(--st-line)" stroke-width="1.5"/>` +
  `<line x1="6" y1="${H / 2}" x2="${W - 6}" y2="${H / 2}" stroke="var(--st-line)" stroke-width="1"/>` +
  `<path fill="var(--st-text)" transform="translate(${PAD},18)" d="${l1.d}"/>` +
  `<path fill="var(--st-text)" transform="translate(${PAD},${H - 8})" d="${l2.d}"/>` +
  `</g></svg>`;

// ---- splice into the built pages (the stamp is the only .dnr svg) --------
const RE = /<svg class="dnr"[\s\S]*?<\/svg>/;
for (const file of TARGETS) {
  const html = await readFile(file, 'utf8');
  if (!RE.test(html)) throw new Error(`${file}: no .dnr stamp found`);
  await writeFile(file, html.replace(RE, svg));
  console.log(`${file}: stamped INKOM ${date} · dnr ${version} (${W}×${H})`);
}
