/**
 * format.js — output.
 *
 * Deliberately NOT `markdown-or-chalk`, which the node-cli-template uses. Measured:
 * it costs 83 transitive packages and ~10 MB, and drags in `yargs@16` via
 * `cli-highlight` — the very library `peowly` was chosen to avoid. Almost all of
 * that weight is a markdown renderer for syntax-highlighted code fences. diarie
 * emits a task list, some counts, and validation errors. It renders no code.
 *
 * If diarie ever grows output worth rendering as markdown, revisit — the finding is
 * logged in UPSTREAM-markdown-or-chalk.md, not buried here.
 *
 * The stdout/stderr split is load-bearing, not stylistic:
 *
 *   stdout = THE ANSWER   (parsed by hooks, skills, `jq`)
 *   stderr = ASIDES       (advisory; ten call sites pipe it to /dev/null)
 *
 * The tracker's absent-store bug survived for months precisely because it put its
 * only real signal on stderr. Anything a caller must not miss goes to stdout and is
 * reflected in the exit code. Nothing important is ever whispered.
 */

import { stderr, stdout } from 'node:process';

/**
 * Print the answer as JSON. Two-space indent — these get read by humans in
 * terminals at least as often as by `jq`.
 *
 * @param {unknown} value
 * @returns {void}
 */
export function jsonOut (value) {
  // TODO: Should have some error handling, no?
  stdout.write(JSON.stringify(value, undefined, 2) + '\n');
}

/**
 * Print the answer as text.
 *
 * @param {string[]} text
 * @returns {void}
 */
export function textOut (...text) {
  const joinedText = text.join('\n');
  stdout.write(joinedText.endsWith('\n') ? joinedText : joinedText + '\n');
}

/**
 * An aside — advisory only. NEVER the sole carrier of something a caller must act
 * on; see the header. If you find yourself wanting to warn() about a condition the
 * caller must handle, it belongs on stdout with a non-zero exit instead.
 *
 * @param {string} message
 * @returns {void}
 */
export function warn (message) {
  // TODO: Should maybe get the CLI name from a constant or such? Writing it directly here feels a bit odd
  stderr.write(`diarie: ${message}\n`);
}
