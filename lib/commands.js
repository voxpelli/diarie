// A NAMESPACE BARREL, DELIBERATELY — `import * as commands` in lib/cli.js yields a module
// namespace object, whose null prototype is a safety property we would otherwise have to
// add by hand: `peowly-commands` indexes this table UNGUARDED (lib/main.js:45), so with an
// ordinary object literal `diarie constructor` would find `Object.prototype.constructor`,
// call `.run(...)` on it, and answer with a stack trace and ZERO BYTES on stdout under
// `--json`. Here that lookup is simply `undefined`, and the answer is a clean EUSAGE.
//
// Declaration order here does NOT set help order: peowly's formatHelpMessage sorts the list
// itself (`Object.keys(list).toSorted(...)` in peowly/lib/format-lists.js:174-176), so the
// help is alphabetical no matter how this file is written. Only `COMMAND_LIST` — built from
// `Object.keys()` in lib/cli.js — follows this file, and a module namespace's keys are
// spec-sorted by code unit, so that is alphabetical too. Consistent, and not ours to choose.
export { init } from './commands/init.js';
export { migrate } from './commands/migrate.js';
export { ready } from './commands/ready.js';
export { stats } from './commands/stats.js';
export { validate } from './commands/validate.js';
