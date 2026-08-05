/**
 * stamp-size.js — write the page's own weight into the page.
 *
 * A BUILD step (`brand:size`): it stamps the deploy output
 * `brand-dist/index.html`, NOT the source `brand/index.html` — same rule as
 * update-stamp.js. Runs LAST in `brand`, because every earlier step
 * (copy, stamp) changes the byte count this one reports.
 *
 * ── Why this is generated rather than written ────────────────────────────
 * diarie.dev's footer states the page's size as proof of its own thesis: "the
 * medium is the proof". That makes it the one claim a reader can check in ten
 * seconds — and it was wrong. It read "one HTML file — ≈50 KiB" while the page
 * was 56 KiB and had gained a linked stylesheet, having gone stale via a GOOD
 * change: linking tokens.css fixed a dead `@media print` rule, and the copy did
 * not follow.
 *
 * A number a human maintains and a checker polices still drifts; it is merely
 * caught afterwards. A number the build DERIVES cannot be wrong, which is the
 * same move the tool itself makes — ready is computed from the dep graph, never
 * stored. check-brand-assets.js still verifies the result, so this generator
 * has a guard rather than being trusted.
 *
 * The source keeps the last generated value so `npm run serve` previews
 * something truthful; the deploy is authoritative.
 */

import { readFile, stat, writeFile } from 'node:fs/promises';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const DIST = new URL('../brand-dist/', import.meta.url);
const PAGE = new URL('index.html', DIST);

/** The sentence, with its number captured. Guarded: no match is an error. */
const CLAIM = /(one HTML file and one stylesheet — )(\d+)( KiB together)/;

/** Files the claim covers — what a reader actually downloads, fonts excluded. */
const COUNTED = ['index.html', 'tokens.css'];

/**
 * Total bytes of the counted files, given a candidate page text.
 *
 * @param {string} page
 * @returns {Promise<number>}
 */
async function total (page) {
  const others = await Promise.all(
    COUNTED.filter(name => name !== 'index.html').map(async name => {
      const info = await stat(new URL(name, DIST));
      return info.size;
    })
  );
  return others.reduce((sum, size) => sum + size, Buffer.byteLength(page, 'utf8'));
}

let page = await readFile(PAGE, 'utf8');
if (!CLAIM.test(page)) {
  throw new Error(`stamp-size: ${fileURLToPath(PAGE)} does not contain the size sentence — ` +
    'reword it back or update CLAIM here. Refusing to leave the claim unstamped.');
}

// Substituting the number can itself change the byte count (a digit more or
// fewer), so iterate to a fixed point rather than assuming one pass converges.
// Two passes is the realistic worst case; the loop asserts rather than trusts.
let stated = 0;
let bytes = 0;
let settled = false;
for (let pass = 0; pass < 5; pass++) {
  bytes = await total(page);
  stated = Math.round(bytes / 1024);
  const next = page.replace(CLAIM, `$1${stated}$3`);
  settled = next === page;
  page = next;
  if (settled) break;
}
if (!settled) {
  throw new Error(`stamp-size: the stated size did not settle after 5 passes (last ${stated} KiB). ` +
    'The page is sitting on a rounding boundary where writing the number changes it.');
}

await writeFile(PAGE, page);
process.stdout.write(`stamped ${stated} KiB into brand-dist/index.html ` +
  `(${COUNTED.join(' + ')} = ${bytes} B)\n`);
