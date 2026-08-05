#!/usr/bin/env node

/**
 * The error boundary. All logic lives in lib/.
 *
 * Exit codes carry meaning, and one of them is the whole point of this tool:
 *
 *   0  the answer is on stdout
 *   1  InputError — you got it wrong. Most importantly: THERE IS NO STORE HERE.
 *   2  ResultError — it ran, and the answer is "no" (invalid store, --strict)
 *
 * NOTHING ELSE MAY USE 2.
 *
 * Under `--json`, an InputError is emitted as JSON on STDOUT, not as prose on
 * stderr. That is deliberate and it is the fix for the defect this CLI was built
 * around: the old readers printed `{"ready": []}` to stdout and their only
 * complaint to stderr — a stream that ten call sites pipe to /dev/null — so a
 * tracker that could not find its store was indistinguishable from one reporting
 * an empty backlog. Anything a caller must not miss goes to stdout, and shows up
 * in the exit code. Nothing important is whispered.
 *
 * One deliberate exception, and it is NARROW: a genuinely bare `diarie`, or an
 * explicit `--help`/`--version`, is help on STDOUT with exit 0 — the npm/yarn
 * convention. The user asked for orientation, so orientation is the right answer
 * in every mode, including `--json`.
 *
 * A FLAG STANDING WHERE A COMMAND BELONGS IS NOT THAT EXCEPTION. `diarie --json
 * ready` is EUSAGE/exit 1: the command was given and would be discarded, which is
 * the founding defect wearing a success code. See lib/cli.js for the guard, and
 * .diarium/decisions/diarie-ncm.md for why the line falls there.
 */

import process, { argv, stderr } from 'node:process';

import { messageWithCauses, stackWithCauses } from 'pony-cause';

import { cli } from './lib/cli.js';
import { InputError, ResultError } from './lib/utils/errors.js';
import { exitResultError } from './lib/utils/exit.js';

try {
  await cli(argv.slice(2));
} catch (err) {
  // `process.exitCode`, NEVER `process.exit()`. This is load-bearing and it has a scar:
  // `process.exit()` does not flush a pending write to a PIPE (stdout to a pipe is async,
  // and the kernel buffer is 64 KB), so writing the answer and then exiting truncated any
  // payload over ~64 KB into unparseable JSON. A `--json` consumer's `jq` then fails, falls
  // back to "no data", and a broken store reads as an empty one — the founding defect,
  // re-entered through the exit code that reports it. Setting `exitCode` lets Node drain
  // stdout and exit naturally. lib/utils/exit.js carries the full account and the tests.
  //
  // The if/else NESTING below is the other half. These handlers no longer terminate, so a
  // flat sequence of `if`s would let a ResultError sail on into the "genuinely unexpected"
  // branch and be answered with a stack trace. The nesting makes that unrepresentable
  // rather than merely discouraged.
  if (err instanceof ResultError) {
    // The command has already said its piece on stdout (validate printed the errors);
    // a second, vaguer complaint here would just be noise. `exitResultError()` rather than
    // a bare `exit(2)`: the code is reserved, and the name is what reserves it.
    exitResultError();
  } else {
    process.exitCode = 1;

    if (err instanceof InputError) {
      if (argv.includes('--json') || argv.includes('-j')) {
        // `body` RIDES ALONG, and leaving it out was a founding-thesis bug of its own: `body` is
        // where this codebase puts every actionable detail, so the machine channel was getting the
        // refusal without the fix. ELOSSY is the case that costs data — the human is handed the
        // full list of fields that would be lost, and bootstrap.js says of it that "every omission
        // costs the reader the one chance they get to see what they are about to lose". Under
        // `--json` that list was not truncated, it was ABSENT: a consumer told two fields would be
        // lost and never which two. EUSAGE dropped the command list; migrate's dropped its usage.
        //
        // The tell that the split was accidental rather than principled: ELEGACY puts its `git mv`
        // in the MESSAGE, so that one remedy survived while its siblings did not.
        //
        // Additive key — the `{error, code}` shape is unchanged for anyone already parsing it.
        const { body, code } = err;
        process.stdout.write(JSON.stringify({
          error: err.message,
          ...(code ? { code } : {}),
          ...(body ? { body } : {}),
        }, undefined, 2) + '\n');
      } else {
        stderr.write(`diarie: ${err.message}\n`);
        if (err.body) {
          stderr.write('\n' + err.body + '\n');
        }
      }
    } else if (err instanceof Error) {
      stderr.write(`diarie: unexpected error: ${messageWithCauses(err)}\n\n`);
      stderr.write(stackWithCauses(err) + '\n');
    } else {
      stderr.write('diarie: unexpected error with no details\n');
    }
  }
}
