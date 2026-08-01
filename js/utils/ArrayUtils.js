/**
 * @file ArrayUtils.js
 * @description Small pure collection helpers used across services and views.
 * Kept deliberately generic — nothing here knows about timetables.
 */

/**
 * Groups items by a derived key.
 * @template T, K
 * @param {T[]} items
 * @param {(item: T) => K} keyFn
 * @returns {Map<K, T[]>}
 */
export function groupBy(items, keyFn) {
  const groups = new Map();
  for (const item of items) {
    const key = keyFn(item);
    const bucket = groups.get(key);
    if (bucket) bucket.push(item);
    else groups.set(key, [item]);
  }
  return groups;
}

/**
 * Indexes items by a unique key for O(1) lookup.
 * @template T, K
 * @param {T[]} items
 * @param {(item: T) => K} keyFn
 * @returns {Map<K, T>}
 */
export function indexBy(items, keyFn) {
  const index = new Map();
  for (const item of items) index.set(keyFn(item), item);
  return index;
}

/**
 * Sums a numeric projection.
 * @template T
 * @param {T[]} items
 * @param {(item: T) => number} valueFn
 * @returns {number}
 */
export function sumBy(items, valueFn) {
  let total = 0;
  for (const item of items) total += valueFn(item);
  return total;
}

/**
 * Returns a new array sorted by one or more comparator projections.
 * Does not mutate the input.
 * @template T
 * @param {T[]} items
 * @param {...((item: T) => number|string)} projections
 * @returns {T[]}
 */
export function sortBy(items, ...projections) {
  return [...items].sort((a, b) => {
    for (const project of projections) {
      const left = project(a);
      const right = project(b);
      if (left < right) return -1;
      if (left > right) return 1;
    }
    return 0;
  });
}

/**
 * Removes duplicates, preserving first-seen order.
 * @template T
 * @param {T[]} items
 * @param {(item: T) => unknown} [keyFn]
 * @returns {T[]}
 */
export function unique(items, keyFn = (item) => item) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = keyFn(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

/**
 * Splits an array into fixed-size chunks.
 * @template T
 * @param {T[]} items
 * @param {number} size
 * @returns {T[][]}
 */
export function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Produces `[0, 1, ..., count - 1]`.
 * @param {number} count
 * @returns {number[]}
 */
export function range(count) {
  return Array.from({ length: Math.max(0, count) }, (_, index) => index);
}

/**
 * Structured deep clone with a JSON fallback for older engines.
 * Used when a command must snapshot state it will later restore.
 * @template T
 * @param {T} value
 * @returns {T}
 */
export function deepClone(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

/**
 * Shallow set equality for arrays of primitives, order-insensitive.
 * @param {Array<string|number>} a
 * @param {Array<string|number>} b
 * @returns {boolean}
 */
export function sameMembers(a, b) {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((item) => set.has(item));
}
