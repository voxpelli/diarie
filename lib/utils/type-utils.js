import { typesafeIsArray } from '@voxpelli/typed-utils';

/**
 * @template {Set<unknown> | ReadonlySet<unknown> | Array<unknown> | ReadonlyArray<unknown>} C
 * @param {C} collection
 * @param {unknown} searchElement
 * @returns {searchElement is (C extends Iterable<infer U> ? U : never)}
 */
export function extendedGuardedArrayIncludes (collection, searchElement) {
  if (typesafeIsArray(collection)) {
    return collection.includes(searchElement);
  }

  if (!(collection instanceof Set)) {
    throw new TypeError('Invalid collection type');
  }

  return collection.has(searchElement);
}
