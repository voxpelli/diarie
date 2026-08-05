/**
 * ids.js — deciding whether a value is usable as an id, before anything mints one from it.
 *
 * INTERNAL, on the `format.js` model: same three importers (the loader, `validate`, the
 * migrator), and not re-exported from `lib/index.js`. It is the deciding half of a guard whose
 * reporting half is `renderRejected`, so the two belong at the same layer.
 *
 * ## Why a predicate has to exist at all
 *
 * `nsId(ref, slug)` is `String(ref)` — total, and therefore blind. Every scalar YAML can parse
 * mints something that LOOKS like an id:
 *
 *     parent: 42        ->  the NUMBER 42   ->  nsId  ->  `backlog/42`
 *     id: '42'          ->  the STRING '42' ->  nsId  ->  `backlog/42`
 *
 * the same `GlobalId` from two rows that share no identity, so an untouched row is silently
 * reclassified as the container of a child it never had — moved out of `ready`, into `blocked`.
 * Both `validate` and `ready --strict` answered 0. And where the misread row carries an `epic`
 * label the fabricated child SATISFIES the "epic with no open children" diagnostic, so the typo
 * also suppresses the one report that would have named it.
 *
 * `true`, `0123`, `1e3`, `0x1F` and `.inf` launder the same way (`backlog/true`,
 * `backlog/123`, `backlog/1000`, `backlog/31`, `backlog/Infinity`). `yes`/`no`/`on`/`off` do
 * not — js-yaml 4 reads YAML 1.2's core schema, where those are strings. A Date is the only
 * value that self-reports, because `String(date)` contains spaces and so fails `ID_RE` — and
 * its `GlobalId` would otherwise be TIMEZONE-DEPENDENT in a payload a machine keys on.
 *
 * ## Two predicates, because the domain is genuinely two-form
 *
 * An `id` is bare. A `parent` or a `deps` element is a REFERENCE, and may be written either
 * bare (namespaced to its own file's slug) or slug-qualified to reach another file. Both forms
 * are tested, and `nsId` branches on exactly this.
 */

import { isType } from '@voxpelli/typed-utils';

import { ID_RE } from './schema.js';

/**
 * A bare task id — the only form an `id:` field may take.
 *
 * `ID_RE`, not a bespoke charset: it is the schema's single authority on id shape and
 * `validate` already applies it to every row, so a reader accepting what the validator rejects
 * is a disagreement rather than a tolerance. That disagreement was live — `id: 'bad id!'` gave
 * `validate` exit 2 while `ready` served `backlog/bad id!` as real work at exit 0.
 *
 * BOTH HALVES ARE INDEPENDENTLY LOAD-BEARING, and neither subsumes the other:
 * `ID_RE.test(String(42))` passes, so only the string check catches an unquoted number; and
 * `'bad id!'` is a perfectly good string, so only `ID_RE` catches a malformed one. `ID_RE`
 * admits no `/`, which closes path traversal (`../../pwned`) for free — the migrator builds
 * `decisions/${id}.md` by interpolation.
 *
 * @param {unknown} v
 * @returns {v is string}
 */
export const isUsableId = (v) => isType(v, 'string') && ID_RE.test(v);

/**
 * A REFERENCE as written: bare `T-1`, or slug-qualified `alpha/T-1`.
 *
 * 🚨 THE SLUG HALF IS DELIBERATELY UNCONSTRAINED, and `ID_RE` on both halves would be a
 * regression rather than a stricter version of this. A slug is not an id — it is a filename
 * fragment, whatever `slugOf` gets after stripping `tasks-` and the extension, and
 * `TASKS_FILE_RE`'s `.+` is the only thing bounding it. So `tasks-Ärende.yml` yields the slug
 * `Ärende`, which fails `ID_RE`; requiring it on both halves would newly refuse every
 * cross-file reference into a legal store. Whether a slug OUGHT to be `ID_RE`-shaped is a real
 * question, and an open one (`diarie-xid`) — deciding it inside a loader guard would answer it
 * by accident.
 *
 * Split at the FIRST slash, matching `nsId`'s own `.includes('/')`. `i > 0` rejects `/T-1`,
 * and a second slash lands in the id half and fails there, so `a/b/c` is refused rather than
 * laundered — `nsId` can never produce one, since a slug comes from a filename.
 *
 * @param {unknown} v
 * @returns {v is string}
 */
export const isUsableRef = (v) => {
  if (!isType(v, 'string')) return false;

  const slash = v.indexOf('/');

  return slash === -1 ? ID_RE.test(v) : slash > 0 && ID_RE.test(v.slice(slash + 1));
};
