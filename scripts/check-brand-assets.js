/**
 * check-brand-assets.js — assert every LOCAL asset the built deploy pages
 * reference actually exists in brand-dist/ and is non-empty. A broken
 * `/apple-touch-icon.png` or a missing font would 404 on the live site while
 * the page itself still renders — the exact silent gap this guard closes.
 *
 * Runs AFTER `brand:build` (as `brand:check`, in the deploy workflow) — NOT in
 * the local `npm test` gate, which never builds brand-dist/.
 *
 * Skipped by design: `data:` refs (the tab favicon is a self-contained
 * data-URI) and `http(s)://` refs (external links aren't ours; og.png is an
 * absolute same-origin URL and is instead covered by brand:copy's loud failure
 * — a missing source throws there).
 */
import { readFile, stat } from 'node:fs/promises';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const DIST = new URL('../brand-dist/', import.meta.url);
const PAGES = ['index.html'];

/**
 * Every local asset reference in an HTML page — `href`/`src` attributes and
 * CSS `url(...)` — minus external, data:, anchor, and mailto: refs.
 *
 * @param {string} html
 * @returns {string[]}
 */
function localRefs (html) {
  /** @type {Set<string>} */
  const refs = new Set();
  for (const match of html.matchAll(/(?:href|src)\s*=\s*"([^"]+)"/gi)) {
    if (match[1]) refs.add(match[1]);
  }
  // Match a QUOTED url() to its closing quote (not the first `)`) so a data-URI
  // whose own content contains `url(#n)` — e.g. the grain-texture SVG — is
  // captured whole and skipped, never mistaken for an asset ref.
  for (const match of html.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^'")\s]+))\s*\)/gi)) {
    const value = match[1] ?? match[2] ?? match[3];
    if (value) refs.add(value);
  }
  return [...refs].filter((ref) =>
    !ref.startsWith('data:') &&
    !ref.startsWith('#') &&
    !ref.startsWith('%23') && // URL-encoded `#` fragment (e.g. an SVG url(#id))
    !ref.startsWith('mailto:') &&
    !/^https?:\/\//i.test(ref)
  );
}

/** @type {string[]} */
const problems = [];
for (const page of PAGES) {
  const html = await readFile(new URL(page, DIST), 'utf8');
  for (const ref of localRefs(html)) {
    // Strip query/hash, then treat a root-relative `/x` as dist-relative `x`.
    const rel = ref.replace(/[?#].*$/, '').replace(/^\//, '');
    const url = new URL(rel, DIST);
    try {
      const info = await stat(url);
      if (info.size === 0) {
        problems.push(`${page} → ${ref} is EMPTY (${fileURLToPath(url)})`);
      }
    } catch {
      problems.push(`${page} → ${ref} is MISSING (${fileURLToPath(url)})`);
    }
  }
}

if (problems.length > 0) {
  process.stderr.write('check:brand-assets — referenced deploy assets missing or empty:\n');
  for (const problem of problems) {
    process.stderr.write(`  ✗ ${problem}\n`);
  }
  process.exit(1);
}
process.stdout.write('check:brand-assets — all referenced local deploy assets present and non-empty\n');
