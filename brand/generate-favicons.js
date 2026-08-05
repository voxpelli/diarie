/**
 * generate-favicons.js — regenerate the deploy favicon(s) into `brand-dist/`.
 *
 * A BUILD step (`brand:3-favicon`), part of `brand`; runs after `brand:1-copy`
 * so `brand-dist/` exists. index.html references exactly one favicon FILE —
 * `/apple-touch-icon.png` (the browser-tab icon is a self-contained inline SVG
 * data-URI, no file) — so that is all we emit.
 *
 * Source is the FULL mark (`diarie-mark.svg`), not the favicon cut: the cut is
 * for ≤32px chrome, while `apple-touch-icon` is 180px, where the design calls
 * for the full mark (its own comment: "use the full mark at 24px and above").
 *
 * Two behaviours are load-bearing and guarded here:
 *   1. The mark colours via CSS `var()` (token references). Rasterizers
 *      (sharp/librsvg) don't resolve custom properties, so every fill would
 *      fall back to BLACK. We flatten var()→hex from the SVG's own `<style>`
 *      map before rasterizing, and throw if any var() is left unresolved.
 *   2. `@voxpelli/generate-favicon` is CLI-only (no exports), writes RELATIVE
 *      to the source SVG's directory, and in the `--size size:name` form the
 *      name is the LITERAL filename (no `.png` appended). We stage the
 *      flattened SVG inside brand-dist/ so the output lands beside it, then
 *      assert the real bytes exist — a wrong name/dir would let the CLI exit 0
 *      while leaving index.html's `/apple-touch-icon.png` a 404.
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  readFile, rm, stat, writeFile,
} from 'node:fs/promises';

// Invoked as the bare binary: npm puts node_modules/.bin on PATH for every
// script, and this only ever runs via `brand:3-favicon`/`brand`. If it is
// ever run outside npm, execFileSync throws ENOENT — loud, not silent.
const BIN = 'generate-favicon';
const SVG_SRC = new URL('diarie-mark.svg', import.meta.url);
const DIST = new URL('../brand-dist/', import.meta.url);
const FLAT_SVG = new URL('.mark-flat.svg', DIST); // staged inside brand-dist/, removed after
const OUT = new URL('apple-touch-icon.png', DIST);
const OUT_PATH = fileURLToPath(OUT);

/**
 * Inline every `var(--token)` using the `--token: #hex` pairs declared in the
 * SVG's own `<style>` block — generic, so it serves any of the brand marks.
 *
 * @param {string} svg - the source SVG markup
 * @returns {string} the SVG with all var() references resolved to literals
 */
function flattenVars (svg) {
  /** @type {Map<string, string>} */
  const vars = new Map();
  for (const match of svg.matchAll(/--([\w-]+)\s*:\s*(#[0-9A-F]{3,8})/gi)) {
    const [, name, value] = match;
    if (name && value) {
      vars.set(name, value);
    }
  }
  const flat = svg.replaceAll(/var\(\s*--([\w-]+)\s*\)/g, (_whole, /** @type {string} */ name) => {
    const value = vars.get(name);
    if (!value) {
      throw new Error(`unresolved CSS var --${name} in ${fileURLToPath(SVG_SRC)}`);
    }
    return value;
  });
  if (flat.includes('var(')) {
    throw new Error(`var() still present after flattening ${fileURLToPath(SVG_SRC)} — a non-hex token?`);
  }
  return flat;
}

await writeFile(FLAT_SVG, flattenVars(await readFile(SVG_SRC, 'utf8')));

// delete-then-generate: a stale icon must never survive a failed regeneration.
await rm(OUT, { force: true });
try {
  execFileSync(
    BIN,
    ['--no-default', '--background', '#171126', '--size', '180:apple-touch-icon.png', fileURLToPath(FLAT_SVG)],
    { stdio: 'inherit' }
  );
} finally {
  await rm(FLAT_SVG, { force: true }); // the staged flattened SVG never ships
}

let info;
try {
  info = await stat(OUT);
} catch {
  throw new Error(
    `generate-favicon exited 0 but ${OUT_PATH} does not exist — its output naming or directory changed. ` +
    'index.html references /apple-touch-icon.png; a wrong name ships a 404.'
  );
}
if (info.size === 0) {
  throw new Error(`${OUT_PATH} is empty — generate-favicon produced a zero-byte file`);
}
const bytes = await readFile(OUT);
if (bytes.length < 8 || bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4E || bytes[3] !== 0x47) {
  throw new Error(`${OUT_PATH} is not a PNG (bad magic bytes)`);
}
console.log(`generated ${OUT_PATH} (${info.size} bytes, 180×180)`);
