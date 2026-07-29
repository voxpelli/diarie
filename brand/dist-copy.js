/**
 * dist-copy.js — reset `brand-dist/` to a clean snapshot of the deployable
 * source, ready for the stamp + favicon generators to write into.
 *
 * A BUILD step (`brand:copy`), the first stage of `brand:build`. It copies
 * only the ALLOWLIST below — the files diarie.dev actually serves — so the
 * design docs and the build tooling never leak into the deploy. `cp` throws
 * if a listed source is missing (loud, per the founding thesis — a missing
 * asset must never silently produce an empty deploy).
 */

import { fileURLToPath } from 'node:url';
import {
  cp, mkdir, readFile, rm, writeFile,
} from 'node:fs/promises';

const SRC = new URL('./', import.meta.url); // brand/
const DIST = new URL('../brand-dist/', import.meta.url); // repo-root sibling

// The deployable set (diarie.dev root). `CNAME` pins the custom domain (Pages
// removes it on deploy if the artifact lacks it); `.nojekyll` is belt-and-suspenders
// for the artifact deploy. Generated favicons are written by brand:favicon.
//
// `tokens.css` IS here because index.html links it rather than inlining a copy.
// That link is render-blocking, so omitting it does not merely lose colour — it
// ships an unstyled page. This is the one entry whose absence is catastrophic
// rather than cosmetic, which is why brand:check asserts referenced assets exist.
//
// brand-book.html is published UNLISTED: it carries `noindex`, and nothing on
// diarie.dev links to it. It drags in the canonical artifacts it displays —
// tokens.json and the three SVGs — because it links them as siblings.
const ASSETS = [
  'index.html',
  'brand-book.html',
  'tokens.css',
  'tokens.json',
  'diarie-mark.svg',
  'diarie-lockup.svg',
  'diarie-favicon.svg',
  'og.png',
  'fonts',
  'CNAME',
  '.nojekyll',
];

// Links that climb out of brand/ are correct on file:// and wrong once the
// directory is flattened into the deploy root — `../BRAND.md` would escape the
// site entirely. Those targets are repo files, so on publish they become links
// to the development home (Tangled). Rewriting rather than copying keeps ONE
// copy of each document: a second BRAND.md served from diarie.dev could drift
// from the repo, which is the failure this whole build exists to avoid.
const REPO_BLOB = 'https://tangled.org/voxpelli.com/diarie/blob/main/';
const ESCAPING_LINK = /(href|src)="\.\.\/([^"]+)"/g;

/**
 * Rewrite every parent-relative link in a copied page to the canonical forge.
 * Throws if any survives — a partially rewritten page ships dead links while
 * looking fine, and a guard that drops a value must report it.
 *
 * WHY A REGEX, when `check-brand-assets.js` insists on parsing HTML properly:
 * because the two are doing opposite jobs. READING asks a question about the
 * whole document, so a regex that misses one attribute quietly under-reports —
 * there, parsing is the only honest instrument. WRITING here is a surgical
 * substitution of one attribute value, and the symmetric tool (parse with
 * hast-util-from-html, edit the tree, serialise with hast-util-to-html) would
 * round-trip the ENTIRE page through parse5 to change two hrefs: re-encoding
 * entities, normalising attribute order and quoting, and silently repairing
 * anything parse5 judges invalid. On a hand-authored page that update-stamp.js
 * also edits textually, that is a far larger blast radius than the edit itself.
 *
 * The regex is only safe because it is GUARDED, not because it is careful: the
 * post-condition below re-scans the output and throws on any survivor, and
 * check-brand-assets.js independently PARSES the built page and rejects any ref
 * that escapes the deploy root. If either ever needs to become smarter than a
 * substitution, parse the tree — do not grow the pattern.
 *
 * @param {string} name
 * @returns {Promise<void>}
 */
async function rewriteEscapingLinks (name) {
  const file = new URL(name, DIST);
  const source = await readFile(file, 'utf8');
  /** @type {string[]} */
  const rewritten = [];
  const output = source.replaceAll(ESCAPING_LINK, (match, attr, path) => {
    // A SECOND `../` climbs above the repo root, and the forge URL has no meaning there.
    // Left to the substitution it would produce `${REPO_BLOB}../thing` — which no longer
    // matches the pattern, so the post-condition below would report a clean rewrite of a
    // link that is now nonsense. (Tangled answers 200 for a path that does not exist, so
    // even fetching it would not tell you.) The pattern is only safe because it is guarded;
    // a case it cannot express has to refuse, not be silently mangled.
    if (path.startsWith('../')) {
      throw new Error(`${name}: ${match} points above the repo root — no forge URL stands in for that`);
    }
    rewritten.push(path);
    return `${attr}="${REPO_BLOB}${path}"`;
  });

  const survivor = output.match(ESCAPING_LINK);
  if (survivor) {
    throw new Error(`${name}: parent-relative link survived the rewrite: ${survivor[0]}`);
  }

  await writeFile(file, output);
  console.log(rewritten.length
    ? `rewrote ${rewritten.length} escaping link(s) in ${name} → ${REPO_BLOB} (${[...new Set(rewritten)].join(', ')})`
    : `no escaping links in ${name}`);
}

await rm(DIST, { recursive: true, force: true });
await mkdir(DIST, { recursive: true });

for (const name of ASSETS) {
  await cp(new URL(name, SRC), new URL(name, DIST), { recursive: true });
  console.log(`copied ${name} → brand-dist/`);
}

await rewriteEscapingLinks('brand-book.html');

console.log(`brand-dist/ ready at ${fileURLToPath(DIST)}`);
