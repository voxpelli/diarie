/**
 * cli.js — command dispatch.
 *
 * `peowly` parses flags but has no subcommands; `peowly-commands` adds the routing
 * layer on top. Each command owns its own flag set and parses it inside `run()`.
 */

import { isErrorWithCode } from '@voxpelli/typed-utils';
import {
  PeowlyCommandMissingError,
  peowlyCommands,
} from 'peowly-commands';

import * as commands from './commands.js';
import { InputError, ResultError } from './utils/errors.js';

/** @import { CliAliases } from 'peowly-commands' */

// SORTED THE WAY PEOWLY SORTS, deliberately and explicitly. `formatHelpMessage` orders the
// help list itself — `Object.keys(list).toSorted(...)`, peowly/lib/format-lists.js:174-176,
// and peowly@1 did the same with `.sort()` — so the help has always been alphabetical no
// matter how lib/commands.js is written. This list appears in EUSAGE error bodies, i.e. right
// next to "Run `diarie --help`", and the two disagreeing would be a small lie about the tool's
// own surface.
//
// It happens to be sorted already, because a module namespace object's keys are spec-sorted by
// code unit — but that is a property of how commands.js is written today, not of the contract.
// Saying it out loud is what makes it survive the barrel becoming an object literal.
//
// Duplicating peowly's ordering is the wart: two implementations of one display rule, which is
// the shape this repo warns about elsewhere. peowly owns the rule and does not export it —
// logged for upstream.
const COMMAND_LIST = `Commands: ${Object.keys(commands).toSorted().join(', ')}\n\nRun \`diarie --help\` for the full usage.`;

// THE ENTIRE TOP-LEVEL FLAG VOCABULARY. We pass `peowlyCommands` no flag options at all,
// so these two are everything `diarie <flag>` can mean — which is what makes the guard in
// `cli()` CATEGORICAL rather than a guess about what the user meant.
//
// `-h` is deliberately ABSENT. peowly defines only the long forms. `diarie -h` used to print
// help purely because it starts with a dash — the identical accident as `diarie --json ready`
// — while `diarie ready -h` has always been EUSAGE. An alias would have papered over that
// asymmetry; peowly sets the standard here, so the alias is not ours to invent.
const META_FLAGS = new Set(['--help', '--version']);

/**
 * Everything a *user* can get wrong is an `InputError` (exit 1). This function is where
 * peowly's error vocabulary is translated into diarie's — see the guards below.
 *
 * @param {string[]} args
 * @returns {Promise<void>}
 */
export async function cli (args) {
  // A FLAG WHERE A COMMAND BELONGS IS A MISTAKE, AND IT MUST BE CAUGHT *BEFORE* DISPATCH.
  //
  // `peowly-commands` nulls out args[0] when it is falsy or starts with `-` (lib/main.js:29-33)
  // and never looks past it — so `diarie --json ready` reads as "no command given", printing
  // help and exiting 0 while `ready` is silently discarded. That is this package's founding
  // defect served by its own entry point: a wrapper running `diarie --json ready | jq .ready`
  // gets prose, jq fails, the wrapper concludes "no work", and the exit code says success.
  //
  // The check is not a heuristic. Since our vocabulary is exactly META_FLAGS, a leading-dash
  // first token that is not one of them is unroutable BY CONSTRUCTION. And it is gated on
  // peowly dispatching nothing, so it is unreachable for any invocation that runs a command:
  // no working command line can regress through here.
  //
  // `git --short status` exits 129 rather than guessing; `cargo`/`gh` exit 1. Not one
  // comparable CLI answers a misplaced flag with success.
  const wantsMeta = args.some(arg => META_FLAGS.has(arg));
  const namesCommand = !!args[0] && !args[0].startsWith('-');

  if (args.length > 0 && !wantsMeta && !namesCommand) {
    // The HINT may be wrong; the EXIT CODE may not. A hint that is sometimes wrong is honest —
    // an exit code that is sometimes wrong is the defect above. So detection feeds only the
    // suggestion, never the classification.
    //
    // `Object.hasOwn` rather than a bare index, for two reasons: it stops a flag's VALUE being
    // named as the command (`--root /x ready` must blame `ready`, not `/x`), and it cannot
    // return an inherited `Object.prototype` member the way `commands['constructor']` would.
    //
    // The suggestion ends in `…` on purpose. Rebuilding the line by filtering the misplaced
    // token out drops EVERY occurrence, so `diarie --root ready` would suggest
    // `diarie ready --root` — a command line missing its flag value, i.e. a confidently-worded
    // false statement. Point at the fix; do not fabricate the command.
    const misplaced = args.find(arg => Object.hasOwn(commands, arg));

    // NAME THE OFFENDING TOKEN. `diarie --nosuchflag` used to answer with help in which
    // `--nosuchflag` appeared nowhere — a report that cannot distinguish "we handled it" from
    // "we threw it away", which is precisely how this row got filed as "not a mistake".
    // `diarie ready --nosuchflag` has always named it; the top level owed the same.
    const [first] = args;

    throw new InputError(
      misplaced
        ? `\`${misplaced}\` is a command, but a flag came before it — flags belong AFTER the command`
        : (first
            ? `no command given — \`${first}\` is a flag, and diarie has no top-level flags except --help and --version`
            : 'no command given'),
      misplaced ? `Try: diarie ${misplaced} …` : COMMAND_LIST,
      'EUSAGE'
    );
  }

  try {
    await peowlyCommands(commands, {
      args,
      name: 'diarie',
      importMeta: import.meta,
      // AN EMPTY TABLE WITH NO PROTOTYPE — a fix, not decoration. peowly-commands defaults
      // `aliases` to a plain `{}` and indexes it UNGUARDED (lib/main.js:37), so
      // `diarie constructor` found `Object.prototype.constructor`, spread `alias.argv`, and
      // died with `TypeError: alias.argv is not iterable` — a stack trace, and ZERO BYTES on
      // stdout under `--json`. Twelve tokens did this (`toString`, `valueOf`, `__proto__`, …).
      // Handing peowly our own null-prototype table makes every one an ordinary unknown
      // command. Reported upstream; this is the downstream half, and it costs one line.
      //
      // `Object.create(null)` rather than `setPrototypeOf({}, null)` or `{__proto__: null}`:
      // the other two trip `unicorn/no-null`, which cannot tell a prototype sentinel from a
      // nullable value. It returns `any`, hence the cast — the 99% type-coverage ratchet
      // would otherwise feel it.
      aliases: /** @type {CliAliases} */ (Object.create(null)),
      // NO COMMAND AT ALL IS NOT A MISTAKE — it is the npm/yarn convention: help, exit 0.
      // This is peowly-commands' own first-class option (`cli.showHelp(0)` at lib/main.js:77-81),
      // preferred over catching PeowlyCommandOmittedError by hand: the explicit `0` is then
      // upstream's tested literal rather than a number we can forget. Forgetting it would let
      // peowly default to `process.exit(2)` — the code lib/utils/exit.js reserves for
      // ResultError — and the `no-unsanctioned-exit-2` ast-grep rule cannot see a library call,
      // only a literal, so nothing here would have gone red.
      //
      // Safe to adopt ONLY because the guard above already removed every other shape that
      // reaches it. Before that guard, this option would have ratified the founding defect.
      showHelpOnNoCommand: true,
    });
  } catch (err) {
    // OUR OWN TAXONOMY PASSES THROUGH UNTOUCHED, and it must be checked FIRST.
    //
    // Without this line, the ERR_PARSE_ARGS_ sniff below reaches `err.code.startsWith`
    // on an InputError whose `code` is undefined — because `isErrorWithCode` is
    // `value instanceof Error && 'code' in value`, a PRESENCE check whose type predicate
    // nonetheless promises `code: string`. It is unsound, and tsc endorses the crash.
    // InputError assigns `this.code` unconditionally, so `'code' in err` is true even
    // when nobody passed one. A future call site that omits the code would turn a clean
    // InputError into a TypeError, answered with a stack trace and — under `--json` — an
    // EMPTY STDOUT: this package's founding defect served by its own error handler.
    if (err instanceof InputError || err instanceof ResultError) throw err;

    // `PeowlyCommandOmittedError` is deliberately NOT handled here: `showHelpOnNoCommand`
    // above means peowly-commands never throws it. It was caught by hand once, and that
    // catch had no `return` — safe only because peowly types `showHelp` as `=> never`, which
    // is exactly the fall-through hazard this file used to carry a comment about.
    //
    // The exit-0 help IS the deliberate exception to the `--json`-errors-on-stdout rule, and
    // it is now scoped to the one shape that earns it: a genuinely bare `diarie`. The help is
    // well under a kilobyte — two orders of magnitude below the 64 KB pipe buffer that
    // lib/utils/exit.js documents. Do not write a measured byte count here: ~40% of the help
    // is command-description text, so any digit rots on the next reword. If a future surface
    // ever approaches that buffer, `showHelp` must stop being `process.exit`.
    if (err instanceof PeowlyCommandMissingError) {
      throw new InputError(`unknown command: ${err.commandName}`, COMMAND_LIST, 'EUSAGE');
    }

    // A TYPO IS NOT A BUG IN THE TOOL. node:util.parseArgs (which peowly wraps) throws
    // these for an unknown flag, a bad flag value, or an unexpected positional. All three
    // are the user's mistake, not ours — answer with a sentence, not node:internal frames.
    //
    // `typeof err.code === 'string'` is NOT redundant with `isErrorWithCode`, however
    // much it reads like it. The guard only proves the KEY exists (see the pass-through
    // comment above). Do not "simplify" this.
    if (isErrorWithCode(err) && typeof err.code === 'string' && err.code.startsWith('ERR_PARSE_ARGS_')) {
      // `cause` preserved: if this branch ever fires on OUR misconfiguration (a command that
      // forgot `allowPositionals`, say), the stack must remain recoverable — otherwise the tool
      // reports its own bug as the user's mistake.
      throw new InputError(err.message, undefined, 'EUSAGE', { cause: err });
    }

    throw err;
  }
}
