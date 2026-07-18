import { voxpelli } from '@voxpelli/eslint-config';

// diarie's own lint config: neostandard via @voxpelli/eslint-config. Semicolons are the neostandard
// default; diarie dropped the `semi: false` it carried as a vp-beads workspace (the `~/Sites/ai`
// no-semicolons convention) when it became a published library, matching the node-* templates it is
// scaffolded from. Per-option rationale is inline below.
export default [
  {
    name: 'diarie/generated-declarations',
    // The `.d.ts` that `npm run build` emits next to their sources (declaration.tsconfig.json), for
    // `prepack` to put in the tarball. They are TypeScript output — semicolons, double quotes — and
    // eslint fails them on sight, so a developer who builds and then checks gets a red gate over
    // generated files they did not write.
    //
    // Ignoring them is the fix, NOT a `clean` step before the check: `check` is `run-p check:*`, and a
    // cleaner racing six parallel gates is a bug waiting to be blamed on something else. tsc and knip
    // are both content with the files present (measured) — only eslint objects, so only eslint is told.
    //
    // `*-types.d.ts` is deliberately NOT ignored: that is the escape hatch for a HAND-WRITTEN ambient
    // declaration, which must stay linted and committed. It is the same convention the clean scripts in
    // @voxpelli/typed-utils use, and it is why the ignore is not a bare `*.d.ts`.
    ignores: ['lib/**/*.d.ts', 'lib/**/*.d.ts.map', '!lib/**/*-types.d.ts'],
  },
  {
    name: 'diarie/build-output',
    // brand-dist/ is generated deploy output (copied source + generated stamp/favicons). It is
    // gitignored, so ast-grep and remark already skip it, and it holds no hand-written JS today —
    // but excluding it here keeps "don't lint built output" structural, not incidental on the day a
    // stray `.js` lands there. It's the one build dir a tool could otherwise wander into.
    ignores: ['brand-dist/'],
  },
  ...voxpelli({
    noMocha: true,
    // Exactly the root's old `diarie/**/*.js` glob, expressed from inside. Test files are included
    // deliberately: they were CLI-treated before this move, and switching owners must change no
    // rule. Dropping them re-armed `n/no-sync` across the suite, which builds its stores with
    // mkdtempSync — a gate change smuggled in under a packaging change.
    cliFiles: ['**/*.js'],
  }),
  {
    name: 'diarie/repo-style',
    rules: {
      // Uniform NAMED imports for node builtins (`import { join } from 'node:path'`).
      // import-style would force node:path alone to a default import.
      'unicorn/import-style': 'off',
      // Paths here are computed from argv, import.meta.url, or a --root the user passed —
      // never untrusted external input. The non-literal-fs "taint" warnings are inherent noise.
      'security/detect-non-literal-fs-filename': 'off',
      'security/detect-non-literal-regexp': 'off',
    },
  },
];
