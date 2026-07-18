/**
 * Unit tests for the brand stamp splice.
 *
 * `spliceStamp` is the one risky part of the stamp generator: string surgery
 * on a built page. It is lifted out of the file's fs side-effects (importing
 * `brand/update-stamp.js` does not read fonts or write HTML — an entry guard
 * gates `main()`), so the loud-failure contract is assertable directly.
 *
 * The point of these tests is the MALFORMED input, per the repo's rule that a
 * refactor/splice proof needs a broken fixture — a happy-path-only test is
 * blind to exactly the drift this guard exists to catch.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { spliceStamp } from '../brand/update-stamp.js';

const STAMP = '<svg class="dnr" role="img" aria-label="x">…</svg>';
const page = (/** @type {string} */ body) => `<footer>\n  ${body}\n</footer>\n`;

describe('spliceStamp', () => {
  it('replaces the single .dnr stamp with the new svg', () => {
    const out = spliceStamp(page(STAMP), '<svg class="dnr">NEW</svg>');
    assert.equal(out, page('<svg class="dnr">NEW</svg>'));
  });

  it('inserts the replacement literally — `$&`/`$1` in the svg are not special', () => {
    // A function replacer means these dollar sequences land as-is instead of
    // being interpreted as replacement patterns (which would splice the match
    // back in, or an empty group).
    const svg = '<svg class="dnr" aria-label="dnr $& $1 $$">x</svg>';
    const out = spliceStamp(page(STAMP), svg);
    assert.ok(out.includes('dnr $& $1 $$'), 'dollar sequences survived verbatim');
  });

  it('throws naming the count when NO stamp is present — never a silent no-op', () => {
    assert.throws(
      () => spliceStamp(page('<p>no stamp here</p>'), STAMP),
      (/** @type {unknown} */ err) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /found 0/);
        return true;
      }
    );
  });

  it('throws when MORE than one stamp is present — an ambiguous replace is rejected', () => {
    assert.throws(
      () => spliceStamp(page(`${STAMP}\n  ${STAMP}`), STAMP),
      (/** @type {unknown} */ err) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /found 2/);
        return true;
      }
    );
  });

  it('rejects a stamp missing its closing tag — the lazy match cannot span to </svg>', () => {
    assert.throws(
      () => spliceStamp(page('<svg class="dnr">unterminated'), STAMP),
      (/** @type {unknown} */ err) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /found 0/);
        return true;
      }
    );
  });
});
