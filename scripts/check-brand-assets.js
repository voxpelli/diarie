/**
 * check-brand-assets.js — assert every LOCAL asset the built deploy references
 * actually exists in brand-dist/ and is non-empty. A broken
 * `/apple-touch-icon.png` or a missing font would 404 on the live site while
 * the page itself still renders — the exact silent gap this guard closes.
 *
 * Runs AFTER `npm run brand` (as `brand-check`, in the deploy workflow) — NOT in
 * the local `npm test` gate, which never builds brand-dist/.
 *
 * HTML is PARSED, not pattern-matched. A regex over markup answers a narrower
 * question than the one being asked: it misses single-quoted attributes,
 * `srcset`, and `xlink:href`, and it happily matches a ref inside an HTML
 * comment that the browser never requests. Both failure directions are silent —
 * a missed ref ships a 404 while this check reports success. hast-util-from-html
 * is a real HTML5 parser (parse5), so comments are comment nodes and attribute
 * quoting stops being our problem.
 *
 * Stylesheets are scanned too. Until tokens.css became a deployed file, every
 * style in this project was inline, so scanning the HTML happened to scan all
 * the CSS. That is no longer true, and a `url(fonts/…)` added to tokens.css
 * would otherwise ship a 404 with this check still green.
 *
 * Skipped by design: `data:` refs (the tab favicon is a self-contained
 * data-URI) and `http(s)://` refs (external links aren't ours; og.png is an
 * absolute same-origin URL and is instead covered by brand:1-copy's loud failure
 * — a missing source throws there).
 */
import { readFile, stat } from 'node:fs/promises';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { fromHtml } from 'hast-util-from-html';

const DIST = new URL('../brand-dist/', import.meta.url);
const PAGES = ['index.html', 'brand-book.html'];

/** Attributes whose value is a single URL. hast camel-cases these. */
const URL_PROPERTIES = ['href', 'src', 'poster', 'xLinkHref', 'data'];

/**
 * A ref worth checking: local, and pointing at a file rather than a fragment.
 *
 * @param {string} ref
 * @returns {boolean}
 */
function isLocalAssetRef (ref) {
  return ref !== '' &&
    !ref.startsWith('data:') &&
    !ref.startsWith('#') &&
    !ref.startsWith('%23') && // URL-encoded `#` fragment (e.g. an SVG url(#id))
    !ref.startsWith('mailto:') &&
    !/^https?:\/\//i.test(ref);
}

/**
 * Every `url(...)` in a chunk of CSS, plus `@import` targets.
 *
 * A QUOTED url() is matched to its closing quote rather than the first `)`, so
 * a data-URI whose own content contains `url(#n)` — e.g. the grain-texture SVG
 * — is captured whole and skipped, never mistaken for an asset ref.
 *
 * @param {string} css
 * @returns {string[]}
 */
function cssRefs (css) {
  /** @type {string[]} */
  const refs = [];
  for (const match of css.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^'")\s]+))\s*\)/gi)) {
    const value = match[1] ?? match[2] ?? match[3];
    if (value) refs.push(value);
  }
  for (const match of css.matchAll(/@import\s+(?:url\(\s*)?["']([^"']+)["']/gi)) {
    if (match[1]) refs.push(match[1]);
  }
  return refs;
}

/**
 * Walk a hast tree, collecting every local asset reference an element carries:
 * URL attributes, `srcset` candidate lists, inline `style` declarations, and
 * the text of any `<style>` element.
 *
 * @param {unknown} node
 * @param {Set<string>} refs
 * @returns {void}
 */
function collectRefs (node, refs) {
  if (typeof node !== 'object' || node === null) return;

  const { children, properties, tagName, type } =
    /** @type {{ type?: unknown, properties?: unknown, children?: unknown, tagName?: unknown }} */ (node);

  if (type === 'element' && typeof properties === 'object' && properties !== null) {
    const props = /** @type {Record<string, unknown>} */ (properties);

    for (const name of URL_PROPERTIES) {
      const raw = props[name];
      if (typeof raw === 'string') refs.add(raw);
    }

    // hast parses `srcset` into a comma-separated array of "url descriptor".
    const { srcSet } = props;
    for (const candidate of Array.isArray(srcSet) ? srcSet : [srcSet]) {
      if (typeof candidate === 'string') {
        const url = candidate.trim().split(/\s+/)[0];
        if (url) refs.add(url);
      }
    }

    if (typeof props['style'] === 'string') {
      for (const ref of cssRefs(props['style'])) refs.add(ref);
    }
  }

  // A <style> element's CSS lives in its text child, not in an attribute — and ONLY a
  // <style> element's. Running cssRefs over every text node in the document was the
  // narrower-question failure in reverse: it answers "does this page contain the letters
  // `url(...)` anywhere", which prose, a <script>, and this site's `<pre>` transcripts can
  // all satisfy without referencing an asset. Each such hit is reported as MISSING, so the
  // check fails on a deploy that is fine.
  if (type === 'element' && tagName === 'style' && Array.isArray(children)) {
    for (const child of children) {
      const { value } = /** @type {{ value?: unknown }} */ (child ?? {});
      if (typeof value === 'string') {
        for (const ref of cssRefs(value)) refs.add(ref);
      }
    }
  }

  if (Array.isArray(children)) {
    for (const child of children) collectRefs(child, refs);
  }
}

/**
 * Resolve a ref against the file that referenced it. A root-relative `/x` is
 * dist-relative here, because brand-dist/ IS the site root.
 *
 * @param {string} ref
 * @param {URL} from
 * @returns {URL}
 */
function resolveRef (ref, from) {
  const clean = ref.replace(/[?#].*$/, '');
  return clean.startsWith('/')
    ? new URL(clean.slice(1), DIST)
    : new URL(clean, from);
}

/** @type {string[]} */
const problems = [];
/** @type {Set<string>} */
const stylesheets = new Set();

for (const page of PAGES) {
  const from = new URL(page, DIST);
  /** @type {Set<string>} */
  const refs = new Set();
  collectRefs(fromHtml(await readFile(from, 'utf8')), refs);

  for (const ref of refs) {
    if (!isLocalAssetRef(ref)) continue;
    const url = resolveRef(ref, from);
    if (url.pathname.endsWith('.css')) stylesheets.add(url.href);
    await check(page, ref, url);
  }
}

// Deployed stylesheets can carry refs of their own; scan the ones the pages link.
for (const href of stylesheets) {
  const from = new URL(href);
  let css;
  try {
    css = await readFile(from, 'utf8');
  } catch {
    continue; // already reported as MISSING by the page that linked it
  }
  for (const ref of cssRefs(css)) {
    if (!isLocalAssetRef(ref)) continue;
    await check(from.pathname.split('/').pop() ?? 'stylesheet', ref, resolveRef(ref, from));
  }
}

/**
 * Record a problem unless the target exists and is non-empty.
 *
 * @param {string} source
 * @param {string} ref
 * @param {URL} url
 * @returns {Promise<void>}
 */
async function check (source, ref, url) {
  // A ref that climbs out of brand-dist/ is dead on the live site even though
  // it resolves perfectly on this filesystem: `../BRAND.md` from the deployed
  // page lands on the repo's real BRAND.md, so stat() would succeed and this
  // check would report green for a link the browser cannot follow. Ask whether
  // it resolves INSIDE the site, not whether the path exists on disk.
  if (!url.href.startsWith(DIST.href)) {
    problems.push(`${source} → ${ref} ESCAPES the deploy root (${fileURLToPath(url)})`);
    return;
  }

  try {
    const info = await stat(url);
    if (info.size === 0) {
      problems.push(`${source} → ${ref} is EMPTY (${fileURLToPath(url)})`);
    }
  } catch {
    problems.push(`${source} → ${ref} is MISSING (${fileURLToPath(url)})`);
  }
}

// ---- the page's claim about its own weight ---------------------------------
// diarie.dev's footer states the page's size as proof of the ethos ("the medium
// is the proof"). It is the one claim on the page a reader can check in ten
// seconds with DevTools, which makes it the most expensive one to get wrong: a
// reader who catches it has caught the thesis failing at the only point they
// could test it, and their rational move is to discount the exit-code claims
// they cannot test.
//
// It HAS been wrong. The stated figure said "one HTML file — ≈50 KiB" while the
// page was 56 KiB and had gained a linked stylesheet — and it went stale via a
// GOOD change (linking tokens.css fixed a dead @media print rule). Nothing was
// watching, because nothing here watched claims, only assets.
//
// A regex is right for this one: the question is not "what does this document
// contain" (parse for that — see the top of this file) but "does this exact
// sentence still hold". The match is guarded, so a reworded footer fails loudly
// rather than skipping the check.
const CLAIM = /one HTML file and one stylesheet — (\d+) KiB together/;

async function checkStatedSize () {
  const page = await readFile(new URL('index.html', DIST), 'utf8');
  const claim = CLAIM.exec(page);
  if (!claim?.[1]) {
    problems.push('index.html no longer states its own size in the form brand-check ' +
      'verifies — reword the footer back, or update CLAIM here to match the new sentence');
    return;
  }

  const sizes = await Promise.all(['index.html', 'tokens.css'].map(async name => {
    const info = await stat(new URL(name, DIST));
    return info.size;
  }));
  const bytes = sizes.reduce((sum, size) => sum + size, 0);

  const actual = Math.round(bytes / 1024);
  const stated = Number(claim[1]);
  if (stated !== actual) {
    problems.push(`index.html claims ${stated} KiB; index.html + tokens.css measure ${actual} KiB ` +
      `(${bytes} B). The footer offers this number as checkable — so it has to be checked.`);
  }
}

await checkStatedSize();

if (problems.length > 0) {
  process.stderr.write('brand-check — referenced deploy assets missing or empty:\n');
  for (const problem of problems) {
    process.stderr.write(`  ✗ ${problem}\n`);
  }
  process.exit(1);
}
process.stdout.write(
  'brand-check — all referenced local deploy assets present and non-empty ' +
  `(${PAGES.length} page(s), ${stylesheets.size} stylesheet(s))\n`
);
