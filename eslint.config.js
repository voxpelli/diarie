import { voxpelli } from '@voxpelli/eslint-config';

// diarie's own lint config: neostandard via @voxpelli/eslint-config. Semicolons are the neostandard
// default; diarie dropped the `semi: false` it carried as a vp-beads workspace (the `~/Sites/ai`
// no-semicolons convention) when it became a published library, matching the node-* templates it is
// scaffolded from. Per-option rationale is inline below.
export default [
  ...voxpelli({
    noMocha: true,
    // Exactly the root's old `diarie/**/*.js` glob, expressed from inside. Test files are included
    // deliberately: they were CLI-treated before this move, and switching owners must change no
    // rule. Dropping them re-armed `n/no-sync` across the suite, which builds its stores with
    // mkdtempSync — a gate change smuggled in under a packaging change.
    cliFiles: ['**/*.js'],
    ignores: ['brand-dist/'],
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
