import { isObject } from '@voxpelli/typed-utils';
import yaml from 'js-yaml';

/**
 * The delimiter, as the WRITER emits it. `dumpDecision` in `lib/migrate/bootstrap.js`
 * produces `---\n<yaml>\n---\n\n<body>\n`; this is the other half of that pair, and the two
 * must be read together whenever either changes.
 */
const OPEN_RE = /^---\r?\n/;

/**
 * @typedef {{ ok: true, data: Record<string, unknown> }} FrontmatterOk
 * @typedef {{ ok: false, reason: string }} FrontmatterFail
 */

/**
 * Split a record's frontmatter from its prose and parse it.
 *
 * Returns a result rather than throwing, because all four ways this fails are things a
 * human typed and can fix, and a caller that has to `try` around a parser tends to collapse
 * them into one message. They are genuinely different mistakes:
 *
 *   - no opening `---`      — the file is prose; nothing here is a record at all
 *   - no closing `---`      — the whole document was read as frontmatter
 *   - YAML that throws      — the commonest is an unquoted `key: value` inside a title
 *   - YAML that is a scalar — parses fine, has no fields, and would otherwise reach the
 *                             field checks as `undefined` for every key: a file reported as
 *                             missing five required fields when the real fault is one
 *
 * That last split is the same shape-versus-value discipline `lintTasks` Pass 0 draws for
 * task files, for the same reason: a shape fault reported as five value faults sends the
 * reader looking in five wrong places.
 *
 * BODY IS NOT RETURNED. Nothing validates prose, and returning it would invite a caller to
 * start — the body is the part of a record diarie deliberately has no opinion about.
 *
 * @param {string} text
 * @returns {FrontmatterOk | FrontmatterFail}
 */
export function parseFrontmatter (text) {
  if (!OPEN_RE.test(text)) {
    return { ok: false, reason: 'no frontmatter — a record must open with a `---` line (its schema fields have nowhere else to live)' };
  }

  const lines = text.split('\n');
  let end = -1;

  for (let i = 1; i < lines.length; i++) {
    if ((lines[i] ?? '').replace(/\r$/, '') === '---') {
      end = i;
      break;
    }
  }

  if (end === -1) {
    return { ok: false, reason: 'unterminated frontmatter — no closing `---`, so the whole file was read as fields' };
  }

  /** @type {unknown} */
  let data;
  try {
    data = yaml.load(lines.slice(1, end).join('\n'));
  } catch (err) {
    return { ok: false, reason: `invalid YAML in frontmatter — ${/** @type {Error} */ (err).message}` };
  }

  // `null` is what empty frontmatter parses to, and it is not a special case worth its own
  // branch: `---\n---` has no fields, which is exactly what the message says.
  if (!isObject(data)) {
    return { ok: false, reason: 'frontmatter is not a mapping — it holds no fields, so no schema field can be read from it' };
  }

  return { ok: true, data };
}
