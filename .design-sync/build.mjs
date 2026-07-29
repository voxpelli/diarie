/**
 * .design-sync/build.mjs — assemble the Claude Design bundle from brand/.
 *
 * ── What /design-sync is, in this repo ───────────────────────────────────
 * claude.ai/design is a design tool: you prompt an agent and it builds UI.
 * Out of the box it designs with generic components. Uploading this bundle
 * teaches it diarie's identity instead, so every design it produces is on
 * brand. diarie ships a CLI, not a component library, so the bundle carries
 * the TOKEN LAYER, the two self-hosted fonts, the brand rules, and one
 * preview card — `shape: "custom"` in config.json, off the skill's two
 * standard shapes (storybook / package). There is no converter for it;
 * this script is the converter.
 *
 * Run: `node .design-sync/build.mjs [outDir]`   (default: ./ds-bundle)
 * Then the /design-sync skill uploads outDir to the project pinned in
 * config.json. This script NEVER uploads and never touches the network.
 *
 * ── Why this file exists at all ──────────────────────────────────────────
 * The first sync (2026-07-19) was assembled BY HAND into a scratchpad that
 * no longer exists. Recovering the recipe a week later meant reading the
 * files back out of the live project — which worked only because nobody had
 * changed them. That is not a reproducible build; it is a backup that
 * happens to be hosted by someone else. Everything below is derived from
 * files tracked in this repo, so a re-sync is a rebuild, not an excavation.
 *
 * ── Deliberately NOT in the deploy ───────────────────────────────────────
 * Nothing here is part of diarie.dev. `brand/foundations.{html,css}` are
 * absent from dist-copy.js's ASSETS on purpose; adding them would publish an
 * internal specimen sheet. `brand:check` therefore never verifies this path.
 * Rendering foundations.html locally checks the LOOK, but it cannot check the
 * bundle's own wiring — there, `fonts/` and `tokens.css` resolve against
 * brand/, where they exist regardless. The assertions below are the substitute:
 * every rewrite is guarded, and the outcomes are checked positively.
 */

import { homedir } from 'node:os';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  cp, lstat, mkdir, readdir, readFile, realpath, rm, writeFile,
} from 'node:fs/promises';

const REPO = new URL('../', import.meta.url);
const BRAND = new URL('brand/', REPO);
const HAND = new URL('bundle/', import.meta.url); // hand-authored bundle parts
const OUT = new URL((process.argv[2] ?? 'ds-bundle') + '/', REPO);

/**
 * A marker written into the output directory, and the ONLY thing that licenses
 * the recursive delete below. Its presence means "this script created this
 * directory, so this script may destroy it."
 */
const STAMP = '.ds-bundle-root';

const config = JSON.parse(await readFile(new URL('config.json', import.meta.url), 'utf8'));

for (const field of ['name', 'projectId']) {
  if (typeof config[field] !== 'string' || config[field] === '') {
    throw new Error(`config.json: ${field} must be a non-empty string — got ${JSON.stringify(config[field])}`);
  }
}

/**
 * The `window.<globalName>` namespace the app binds the bundle under. Derived,
 * not stored, so it cannot drift from the project it belongs to.
 *
 * @type {string}
 */
const NAMESPACE = config.name.replaceAll(/(?:^|\s)(\w)/g, (_, c) => c.toUpperCase()).replaceAll(/\s/g, '') +
  '_' + config.projectId.slice(0, 6);

// config.name is free-form prose, and this is the one value injected verbatim
// into generated SOURCE (`window.${NAMESPACE}`). Renaming the project to
// "diarie-brand tokens" emits a file that will not parse; "diarie.dev tokens"
// emits one that parses and then writes onto an unrelated `window.Diarie`,
// which is worse — valid-looking output, wrong behaviour, no exit code. Nothing
// downstream parses this file, so the assertion has to happen here.
if (!/^[a-z_$][\w$]*$/i.test(NAMESPACE)) {
  throw new Error(
    `config.json: name ${JSON.stringify(config.name)} derives the namespace ` +
    `${JSON.stringify(NAMESPACE)}, which is not a valid JavaScript identifier — ` +
    '_ds_bundle.js would not parse in the app'
  );
}

/** The one preview card, named once — it is both a mkdir target and a write target. */
const CARD = 'components/foundations/Foundations/Foundations.html';

/** Fonts to ship: woff2 + the OFL licences. Never the .ttf, never brand/fonts/README.md. */
const FONTS = [
  'Fraunces-VF.woff2',
  'Fraunces-Italic-static.woff2',
  'Fraunces-OFL.txt',
  'FragmentMono-Regular.woff2',
  'FragmentMono-OFL.txt',
];

/**
 * Apply one required substitution, or throw naming the consequence.
 *
 * Every rewrite below is load-bearing: a silently-skipped one ships a bundle
 * that looks fine and renders wrong (an unresolvable `@import` costs a design
 * every token it has). A guard that drops a value must report it.
 *
 * The replacement is passed as a FUNCTION, not a string: a string replacement
 * gives `$&`, `` $` `` and `$1` special meaning, so a future replacement
 * containing a `$` would silently corrupt the output instead of inserting
 * itself. A function replacer has no such syntax.
 *
 * @param {string} source
 * @param {string|RegExp} find
 * @param {string} replace
 * @param {string} what
 * @returns {string}
 */
function must (source, find, replace, what) {
  const output = source.replace(find, () => replace);
  if (output === source) throw new Error(`${what}: pattern not found — ${find}`);
  return output;
}

/**
 * Refuse to recursively delete anything this script did not create.
 *
 * `rm(OUT, {recursive:true, force:true})` is the single most destructive line
 * in this repo's tooling, and `OUT` comes straight from argv. URL resolution is
 * generous in exactly the wrong way: `.` resolves to the repo root, `..` to its
 * parent, `''` to the filesystem root. But an ancestor check alone is not
 * enough — `~/Documents` is not an ancestor of anything here, and wiping it
 * would be just as final.
 *
 * So the licence to delete is POSITIVE, not the absence of a red flag: the
 * directory must not exist, or be empty, or carry this script's own marker.
 * Everything else is refused by name. Deleting the wrong directory is not
 * recoverable, so this errs toward refusing a legitimate build.
 *
 * @param {URL} out
 * @returns {Promise<void>}
 */
async function assertSafeToWipe (out) {
  const shown = fileURLToPath(out);
  /**
   * Abort, naming the directory and the reason.
   *
   * @param {string} why
   */
  const refuse = (why) => {
    throw new Error(`refusing to delete ${shown}: ${why}\n` +
      '  The output directory is erased before every build, so it must be one this\n' +
      '  script owns. Point it at a path that does not exist yet, or remove that\n' +
      '  directory yourself if you are certain.');
  };

  /**
   * ENOENT means "nothing there to destroy" and is the one benign failure.
   * Every other errno — ENOTDIR, EACCES, ELOOP — means the path could not be
   * INSPECTED, and a directory that cannot be checked must never be deleted on
   * the assumption that it is absent.
   *
   * @param {unknown} err
   * @returns {void}
   */
  const assertMissing = (err) => {
    const code = /** @type {{ code?: unknown }} */ (err)?.code;
    if (code !== 'ENOENT') refuse(`it could not be inspected (${String(code ?? err)})`);
  };

  // Resolve symlinks first: every check below compares paths, and an unresolved
  // link would let a safe-looking argument stand in for a dangerous target.
  let real = out;
  try {
    real = new URL(await realpath(out) + '/', 'file:///');
  } catch (err) {
    assertMissing(err); // does not exist yet — the safest case, handled below
  }

  if (REPO.href.startsWith(real.href)) refuse('it contains this repository');

  const home = new URL(homedir() + '/', 'file:///');
  if (home.href.startsWith(real.href)) refuse('it is your home directory or an ancestor of it');

  // Two segments is not a build output; it is a system directory.
  if (real.pathname.replaceAll(/^\/|\/$/g, '').split('/').filter(Boolean).length < 2) {
    refuse('it is too close to the filesystem root to be a build output');
  }

  // lstat the path WITHOUT its trailing slash. `OUT` is a directory URL, so it
  // always ends in `/` — and a trailing slash makes lstat resolve the link it
  // is supposed to be reporting on, which would leave the symlink branch below
  // permanently dead while still looking like a guard.
  let info;
  try {
    info = await lstat(fileURLToPath(out).replace(/\/+$/, ''));
  } catch (err) {
    assertMissing(err);
    return; // genuinely absent — nothing to destroy
  }

  if (info.isSymbolicLink()) refuse('it is a symlink, so the delete would not land where the path suggests');
  if (!info.isDirectory()) refuse('it is a file, not a directory');

  const entries = await readdir(out);
  if (entries.length === 0) return; // empty — nothing to destroy
  if (!entries.includes(STAMP)) {
    refuse(`it holds ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'} and no ${STAMP} marker, ` +
      'so it was not created by this script');
  }
}

await assertSafeToWipe(OUT);
await rm(OUT, { recursive: true, force: true });
// The marker goes down BEFORE any content, so that a build which crashes
// halfway still leaves a directory the next run is allowed to clean up.
// Written last, it would strand every failed build behind a manual `rm`.
await mkdir(OUT, { recursive: true });
await writeFile(new URL(STAMP, OUT), `Written by .design-sync/build.mjs in the diarie repo.
This directory is DELETED AND REBUILT on every run. The build refuses to
delete any directory that does not carry this file, so removing it means the
next build will refuse rather than erase whatever it finds here.
`);

for (const dir of ['tokens', 'fonts', 'guidelines', CARD.replace(/\/[^/]+$/, '')]) {
  await mkdir(new URL(dir, OUT), { recursive: true });
}

// ---- tokens + fonts: verbatim from brand/, the source of truth --------------
await cp(new URL('tokens.css', BRAND), new URL('tokens/tokens.css', OUT));
await cp(new URL('tokens.json', BRAND), new URL('tokens/tokens.json', OUT));
for (const font of FONTS) {
  await cp(new URL(`fonts/${font}`, BRAND), new URL(`fonts/${font}`, OUT));
}

// ---- the entry stylesheet: RENAMED, and its @import re-pointed --------------
// brand/ keeps tokens.css as a sibling; the bundle nests it under tokens/. The
// name is fixed by the app — a rendered design receives only the transitive
// @import closure of a file called `styles.css`. See brand/foundations.css.
// The find is ANCHORED to the start of a line, and that is load-bearing:
// foundations.css's own header prints the before/after pair as documentation,
// so a plain string find would match the COMMENT first, rewrite that, and leave
// the real declaration untouched — with must() none the wiser, because
// something did change. The comment's copies sit behind ` * `, so `^` excludes
// them. The post-condition then checks the outcome rather than the attempt.
const entry = must(
  await readFile(new URL('foundations.css', BRAND), 'utf8'),
  /^@import "tokens\.css";$/m,
  '@import "tokens/tokens.css";',
  'styles.css @import'
);
if (/^@import "tokens\.css";$/m.test(entry) || !/^@import "tokens\/tokens\.css";$/m.test(entry)) {
  throw new Error(
    'styles.css: the tokens @import did not survive the rewrite — every design ' +
    'this bundle renders would resolve no tokens at all'
  );
}
// The @font-face url()s and the FONTS list have to agree. styles.css is the
// whole closure a design receives, so a face it references but the bundle omits
// 404s in EVERY rendered design and silently falls back. Rendering
// foundations.html locally cannot catch this: there, `fonts/` resolves against
// brand/, where the file does exist — the instrument would be answering a
// narrower question than the one being asked.
const missingFonts = [...entry.matchAll(/url\(fonts\/([^)]+)\)/g)]
  .map(match => match[1])
  .filter(font => font !== undefined && !FONTS.includes(font));
if (missingFonts.length > 0) {
  throw new Error(`fonts: styles.css references ${missingFonts.join(', ')}, which FONTS does not ` +
    'ship — every rendered design would 404 them');
}

await writeFile(new URL('styles.css', OUT), entry);

// ---- prose: the agent reads these before styling and before writing copy ----
await cp(new URL('README.md', HAND), new URL('README.md', OUT));
await cp(new URL('guidelines/identity.md', HAND), new URL('guidelines/identity.md', OUT));

// ---- the component bundle: empty by design ---------------------------------
// diarie ships a CLI. There are no React components to compile, so the bundle
// is the well-formed empty case rather than an omission — the app expects the
// file and its @ds-bundle header.
await writeFile(new URL('_ds_bundle.js', OUT), `/* @ds-bundle: ${JSON.stringify({
  format: 4,
  namespace: NAMESPACE,
  components: [],
  sourceHashes: {},
  inlinedExternals: [],
  unexposedExports: [],
})} */

(() => {

const __ds_ns = (window.${NAMESPACE} = window.${NAMESPACE} || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

})();
`);

// ---- adherence lint config: DERIVED, so the token list cannot go stale ------
// The first sync hand-listed 42 tokens. brand/tokens.css now defines more, and
// a hand-maintained copy is exactly the kind of second source of truth that
// drifts without anything going red.
const tokensCss = await readFile(new URL('tokens.css', BRAND), 'utf8');

/**
 * Remove an at-rule and its body, brace-matched.
 *
 * @param {string} css
 * @param {string} header
 * @returns {string}
 */
function stripAtRule (css, header) {
  const start = css.indexOf(header);
  if (start === -1) return css;
  const open = css.indexOf('{', start);
  if (open === -1) return css;
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) return css.slice(0, start) + css.slice(i + 1);
  }
  return css;
}

// tokens.css states its own rule for the print sub-palette: kept in one
// checkable place but "referenced only inside the pages' @media print blocks,
// never added to the screen `colors` palette". A scope-blind scrape would hand
// the design agent --print-ground as an available colour; used outside @media
// print it is undefined, and an undefined var() inside a SHORTHAND discards the
// whole declaration (IACVT) — a bug this repo has already shipped once.
const screenCss = stripAtRule(tokensCss, '@media print');
const tokens = [...new Set([...screenCss.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gim)].map(m => m[1]))].toSorted();

const leaked = tokens.filter(token => token.startsWith('--print-'));
if (leaked.length > 0) {
  throw new Error(`tokens: print-only ${leaked.join(', ')} reached the screen vocabulary — ` +
    'the @media print block was not excluded');
}

// A floor, in the spirit of check:ast-grep's scannedFileCount. The extraction is
// a line regex over hand-formatted CSS: collapse two declarations onto one line
// and they vanish silently, shipping a design agent that does not know the
// brand's own vocabulary while this build still prints a count and exits 0.
const TOKEN_FLOOR = 53; // 56 defined, less the 3 print-only — 2026-07-29
if (tokens.length < TOKEN_FLOOR) {
  throw new Error(`tokens: extracted ${tokens.length} from brand/tokens.css, below the floor of ` +
    `${TOKEN_FLOOR} — either the file lost tokens or the extraction stopped matching its formatting`);
}

/** @type {string[]} */
const unclassified = [];

/**
 * Classify a token for the app's adherence linter.
 *
 * The token LIST above is derived and cannot go stale. These KINDS are still a
 * hand-written heuristic over a vocabulary that is expected to grow, so the
 * fallthrough REPORTS what it guessed rather than silently calling every
 * unrecognised token a colour — which is how the drift the derivation removes
 * would otherwise reappear one line lower.
 *
 * @param {string} name
 * @returns {'color' | 'font' | 'spacing' | 'other'}
 */
const kindOf = (name) => {
  if (name.startsWith('--stil-')) return 'font'; // font FAMILIES; --snitt-* are variation settings
  if (/^--(?:snitt|dur|ease|z)-/.test(name) || name === '--korn') return 'other';
  if (name === '--radie' || name === '--hallinje') return 'spacing';
  if (/^--(?:arkiv|yta|papper|lavendel|hektograf|fosfor|barnsten|stampel|blad|lysning|exit|status|grund|text|lank|kant|markering)\b/.test(name)) {
    return 'color';
  }
  unclassified.push(name);
  return 'color';
};

await writeFile(new URL('_adherence.oxlintrc.json', OUT), JSON.stringify({
  plugins: ['react', 'import'],
  rules: {
    'react/forbid-elements': ['warn', { forbid: [] }],
    'no-restricted-imports': ['warn', { patterns: [] }],
    'no-restricted-syntax': ['warn',
      { selector: 'Literal[value=/#[0-9a-fA-F]{3,8}\\b/]', message: 'Raw hex color — use a design-system color token via var().' },
      { selector: 'Literal[value=/\\b\\d+px\\b/]', message: 'Raw px value — use a design-system spacing token via var().' },
      { selector: "Literal[value=/font-family\\s*:\\s*(?!['\\\"]?(?:Fraunces|Fragment Mono))/i]", message: 'Font not provided by the design system. Available: Fraunces, Fragment Mono.' },
    ],
  },
  overrides: [{ files: ['**/index.js'], rules: { 'no-restricted-imports': 'off' } }],
  'x-omelette': {
    components: {},
    tokens,
    tokenKinds: Object.fromEntries(tokens.map(t => [t, kindOf(t)])),
    fontFamilies: ['Fragment Mono', 'Fraunces'],
  },
}, undefined, 2) + '\n');

if (unclassified.length > 0) {
  process.stdout.write(`  ! no kindOf() rule for ${unclassified.join(', ')} — shipped as "color". ` +
    'Add a branch if that is wrong; the design agent is told these are colours.\n');
}

// ---- the preview card: adapted from brand/foundations.html ------------------
// The page is the durable source; this is the only transform between them, and
// the rule is narrower than "strip the page-level things". The card KEEPS its
// doctype, <head>, <title> and viewport meta; what goes is only what would 404
// from the card's own directory, plus what the app needs in order to index it.
// (The CSS `url(fonts/…)` need no rewrite for the same reason: styles.css sits
// beside fonts/ in the bundle exactly as foundations.css does in brand/.)
//   1. prepend the @dsCard marker — the app builds its card index from line 1
//   2. foundations.css (sibling) → ../../../styles.css (bundle root)
//   3. drop the font preloads — document-relative, so in the app they resolve
//      against its root and 404
//   4. drop the favicon link — same reason
//   5. replace the page's head comment: it addresses a reader of this repo and
//      would be actively false here, naming foundations.css and `npm run serve`
const PROVENANCE = `<!-- GENERATED from brand/foundations.html by .design-sync/build.mjs
     in the diarie repo. Do not edit this copy — the next build overwrites it. -->`;

let card = await readFile(new URL('foundations.html', BRAND), 'utf8');
card = must(card, '<link rel="stylesheet" href="foundations.css">',
  '<link rel="stylesheet" href="../../../styles.css">', 'card stylesheet link');
card = must(card, /^<!-- The token layer as a specimen sheet\.[\s\S]*?-->\n/m,
  PROVENANCE + '\n', 'card head comment');
card = must(card, /^<link rel="preload"[^>]*>\n/gm, '', 'card preload strip');
card = must(card, /^<link rel="icon"[^>]*>\n/m, '', 'card favicon strip');
card = '<!-- @dsCard group="Brand" -->\n' + card;

// POSITIVE first: a card that lost its stylesheet link entirely passes every
// negative check below and ships rendering unstyled.
if (!card.startsWith('<!-- @dsCard group="Brand" -->\n')) {
  throw new Error('card: the @dsCard marker must be the first line — the app builds its index from it');
}
if (!card.includes('href="../../../styles.css"')) {
  throw new Error('card: the bundle stylesheet link is absent — the card would render unstyled');
}
// Quote-agnostic: `rel=preload` and `rel='preload'` are as valid as the double
// -quoted form, and a check that only knows one of them reports success on the
// other two.
const stray = /<link[^>]+\brel\s*=\s*["']?(?:preload|icon)\b/i.exec(card) ??
  /href=["']foundations\.css["']/i.exec(card);
if (stray) throw new Error(`card: a page-only link survived the adaptation — ${stray[0]}`);

await writeFile(new URL(CARD, OUT), card);

process.stdout.write(`ds-bundle ready at ${fileURLToPath(OUT)}
  namespace   ${NAMESPACE}
  tokens      ${tokens.length} (derived from brand/tokens.css, floor ${TOKEN_FLOOR})
  fonts       ${FONTS.length}
  card        ${CARD}
  project     https://claude.ai/design/p/${config.projectId}\n`);
