/**
 * Error taxonomy, from node-cli-template.
 *
 * `InputError` — the user got it wrong (bad flag, no store here). Exit 1, message
 * only; the cause chain is deliberately hidden, because a stack trace is not an
 * answer to "you pointed me at the wrong directory".
 *
 * `ResultError` — the operation ran and the answer is "no". Exit 2, no message:
 * the command has already said its piece on stdout. `validate` finding errors is
 * the canonical case — the errors ARE the output.
 *
 * ## The layering, stated because getting it wrong cost a critical bug
 *
 * This module imports NOTHING. It is the shared base every other layer may depend on —
 * the `store/` modules, the flags, the commands — and doing so is a downward dependency, not a
 * boundary crossed. `lib/schema.js` owns the `code` VOCABULARY for the same reason it owns
 * every other vocabulary; this file owns the error SHAPES.
 *
 * THE INVARIANT: **anything that can reach `cli.js` must be an `InputError` or a
 * `ResultError`.** Anything else lands in cli.js's "genuinely unexpected" branch and is
 * answered with a stack trace on stderr and NOTHING on stdout — which a `--json` caller reads
 * as "no data", i.e. this package's founding defect served by its own error handler.
 *
 * That invariant used to be maintained by CONVERSION: `requireRoot` caught the store errors
 * and re-threw them as `InputError`. It held for every command that resolved a store through
 * the flags layer, and `init` does not — so `diarie init --json` in a two-store directory
 * printed a stack trace. A rule enforced at one call site is not a rule; the store errors now
 * satisfy it by EXTENDING `InputError` at their definition, where no caller can forget.
 *
 * The guard is `test/cli.spec.js`'s error-code table, which drives a spawned `cli.js` for every
 * member of `VALID_ERROR_CODES` and fails if one is unexercised. Add a code, add a case.
 */

/**
 * @import { ErrorCode } from '../schema.js'
 */

export class InputError extends Error {
  /** @override */
  name = 'InputError';

  /**
   * @param {string} message
   * @param {string} [body]
   * @param {ErrorCode} [code]  machine-readable tag for --json consumers.
   *   Typed against the schema's vocabulary rather than `string`: this value is a published
   *   contract callers branch on, and as a bare `string` a typo compiled clean.
   * @param {ErrorOptions} [options]  `{ cause }` — preserved when an upstream error is
   *   re-thrown as one of ours, so a genuine bug wearing a user-error's clothes stays diagnosable
   */
  constructor (message, body, code, options) {
    super(message, options);

    /** @type {string|undefined} */
    this.body = body;

    /** @type {ErrorCode|undefined} */
    this.code = code;
  }
}

export class ResultError extends Error {
  /** @override */
  name = 'ResultError';
}
