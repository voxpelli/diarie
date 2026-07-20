# Contributing to diarie

Development happens on [Tangled](https://tangled.org/voxpelli.com/diarie). The
[GitHub repository](https://github.com/voxpelli/diarie) is a mirror — issues are disabled and only
collaborators can open pull requests there — so there is one place to look, not two that drift apart.

- **Report a bug or request a feature:**
  [file an issue on Tangled](https://tangled.org/voxpelli.com/diarie/issues).
- **Propose a change:** open a pull request against the
  [Tangled repository](https://tangled.org/voxpelli.com/diarie).

## Before you start

`diarie` is intentionally small — a *reader* over YAML files you own, with no daemon, no database, and
no git hooks. Changes that add an opinion about your workflow (a board, a wizard, a write API, an MCP
server) are out of scope by design. If in doubt, open an issue on Tangled to discuss before writing
code.

## Working on the code

```sh
npm install
npm test    # the full gate: linting/checks, then tests
```

`npm test` is the first-class "run everything" verb; `npm run check` runs the linting/checks only. The
codebase is ESM-only with JSDoc types (`tsc` checks, never compiles) and
[neostandard](https://github.com/neostandard/neostandard) style. See
[`CLAUDE.md`](./CLAUDE.md) for the architecture and conventions.
