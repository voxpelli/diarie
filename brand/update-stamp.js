/**
 * update-stamp.js — regenerate the INKOM footer stamp with the current
 * date and package version, as outlined SVG paths (no fonts at runtime,
 * no rasterizer stair-stepping — see HANDOFF.md, "rotated text").
 *
 * A BUILD step: it stamps the deploy output `brand-dist/index.html`, NOT the
 * pristine source `brand/index.html` (whose stamp is the designer's bespoke
 * artifact). Run after `brand:copy` has populated brand-dist/. Part of
 * `brand:build`; never part of the local gate. Usage:
 *   npm run brand:build                                  # copy + stamp + favicons
 *   STAMP_DATE=2026-08-01 STAMP_VERSION=1.0.0 npm run brand:stamp   # stamp only
 *
 * Fragment Mono is monospace, so plain glyph outlining + letter-spacing is
 * shaping-complete — no HarfBuzz needed on this side of the pipeline.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import opentype from 'opentype.js';

/**
 * @import { Font } from 'opentype.js'
 */

// ---- stamp geometry: keep in sync with the values in HANDOFF.md ----------
const SIZE = 12;        // px
const TRACK = 0.08;     // em, letter-spacing
const PAD = 14;         // px, inner padding
const H = 46;           // px, rect height
const ROT = -4;         // deg, baked into the geometry

// Paths are resolved relative to THIS file, not the caller's cwd — so the
// script works from `npm run`, a bare `node brand/update-stamp.js`, or any
// other cwd. The font is read from pristine source (brand/fonts/); the stamp
// is written into the BUILD output (brand-dist/, a sibling of brand/).
const FONT_URL = new URL('fonts/FragmentMono-Regular.ttf', import.meta.url);
const PACKAGE_URL = new URL('../package.json', import.meta.url);
const TARGET_URLS = [
  new URL('../brand-dist/index.html', import.meta.url),
];

// The stamp is the only `.dnr` svg on a page. Global flag so a stray second
// stamp is COUNTED (and rejected) rather than silently ignored.
const DNR_RE = /<svg class="dnr"[\s\S]*?<\/svg>/g;

/**
 * Replace the single `.dnr` stamp SVG in a built page. Throws unless EXACTLY
 * one stamp is present: zero means the page structure drifted and the stamp
 * would be dropped silently; more than one means an ambiguous replace that
 * would clobber more than intended. Uses a function replacer so `$`/`$&` in
 * the interpolated date/version can never be treated as replacement patterns.
 *
 * @param {string} html - the page source
 * @param {string} svg - the freshly outlined stamp
 * @returns {string} the page with its stamp replaced
 */
export function spliceStamp (html, svg) {
  const count = (html.match(DNR_RE) ?? []).length;
  if (count !== 1) {
    throw new Error(`expected exactly one .dnr stamp, found ${count}`);
  }
  return html.replaceAll(DNR_RE, () => svg);
}

/**
 * Outline the two stamp lines and assemble the rotated SVG.
 *
 * @param {Font} font - a parsed Fragment Mono
 * @param {string} date - ISO date for the INKOM line
 * @param {string} version - package version for the dnr line
 * @returns {string} the stamp SVG markup
 */
function buildStampSvg (font, date, version) {
  const shape = (/** @type {string} */ text) => ({
    d: font
      .getPath(text, 0, 0, SIZE, { kerning: true, letterSpacing: TRACK })
      .toPathData(1),
    w: font.getAdvanceWidth(text, SIZE, { letterSpacing: TRACK }),
  });

  const l1 = shape(`INKOM ${date}`);
  const l2 = shape(`dnr ${version}`);
  const W = Math.round(Math.max(l1.w, l2.w) + 2 * PAD);

  return (
    `<svg class="dnr" role="img" aria-label="Received ${date}, diarienummer ${version}" ` +
    `width="${W + 18}" height="${H + 16}" viewBox="-9 -8 ${W + 18} ${H + 16}" overflow="visible">` +
    `<g transform="rotate(${ROT} ${Math.round(W / 2)} ${Math.round(H / 2)})">` +
    `<rect x="0" y="0" width="${W}" height="${H}" fill="none" stroke="var(--st-line)" stroke-width="1.5"/>` +
    `<line x1="6" y1="${H / 2}" x2="${W - 6}" y2="${H / 2}" stroke="var(--st-line)" stroke-width="1"/>` +
    `<path fill="var(--st-text)" transform="translate(${PAD},18)" d="${l1.d}"/>` +
    `<path fill="var(--st-text)" transform="translate(${PAD},${H - 8})" d="${l2.d}"/>` +
    '</g></svg>'
  );
}

async function main () {
  const date = process.env['STAMP_DATE'] ?? new Date().toISOString().slice(0, 10);
  const version =
    process.env['STAMP_VERSION'] ??
    JSON.parse(await readFile(PACKAGE_URL, 'utf8')).version;

  // Slice to a correctly-bounded ArrayBuffer: a Node Buffer's `.buffer` can be
  // a shared pool larger than the file, so pass only this file's bytes.
  const fontBuf = await readFile(FONT_URL);
  const font = opentype.parse(
    fontBuf.buffer.slice(fontBuf.byteOffset, fontBuf.byteOffset + fontBuf.byteLength)
  );

  const svg = buildStampSvg(font, date, version);

  for (const url of TARGET_URLS) {
    const file = fileURLToPath(url);
    const html = await readFile(url, 'utf8');
    let stamped;
    try {
      stamped = spliceStamp(html, svg);
    } catch (err) {
      throw new Error(`${file}: ${/** @type {Error} */ (err).message}`, { cause: err });
    }
    await writeFile(url, stamped);
    console.log(`${file}: stamped INKOM ${date} · dnr ${version}`);
  }
}

// Run only when executed directly — importing the module (e.g. from a test)
// must not read fonts or write HTML.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
