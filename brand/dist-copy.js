/**
 * dist-copy.js — reset `brand-dist/` to a clean snapshot of the deployable
 * source, ready for the stamp + favicon generators to write into.
 *
 * A BUILD step (`brand:copy`), the first stage of `brand:build`. It copies
 * only the ALLOWLIST below — the files diarie.dev actually serves — so the
 * design docs, the brand book, and the build tooling never leak into the
 * deploy. `cp` throws if a listed source is missing (loud, per the founding
 * thesis — a missing asset must never silently produce an empty deploy).
 */
import { cp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const SRC = new URL('./', import.meta.url); // brand/
const DIST = new URL('../brand-dist/', import.meta.url); // repo-root sibling

// The deployable set (diarie.dev root). `CNAME` pins the custom domain (Pages
// removes it on deploy if the artifact lacks it); `.nojekyll` is belt-and-suspenders
// for the artifact deploy. Generated favicons are written by brand:favicon.
// brand-book.html is deliberately NOT here — it stays a file:// local reference.
//
// `tokens.css` IS here because index.html links it rather than inlining a copy.
// That link is render-blocking, so omitting it does not merely lose colour — it
// ships an unstyled page. This is the one entry whose absence is catastrophic
// rather than cosmetic, which is why brand:check asserts referenced assets exist.
const ASSETS = ['index.html', 'tokens.css', 'og.png', 'fonts', 'CNAME', '.nojekyll'];

await rm(DIST, { recursive: true, force: true });
await mkdir(DIST, { recursive: true });

for (const name of ASSETS) {
  await cp(new URL(name, SRC), new URL(name, DIST), { recursive: true });
  console.log(`copied ${name} → brand-dist/`);
}

console.log(`brand-dist/ ready at ${fileURLToPath(DIST)}`);
