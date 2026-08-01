/**
 * @file IdGenerator.js
 * @description Collision-resistant identifier generation.
 *
 * Ids are generated client-side because there is no server to allocate them.
 * They must survive export → import into another browser without colliding,
 * which rules out simple counters.
 */

/** Characters used for the random suffix — no ambiguous 0/O/1/l. */
const ALPHABET = '23456789abcdefghijkmnpqrstuvwxyz';

/**
 * Generates a random suffix of the requested length.
 * Uses crypto.getRandomValues when available for real entropy.
 * @param {number} length
 * @returns {string}
 */
function randomSuffix(length) {
  const out = new Array(length);
  const crypto = globalThis.crypto;

  if (crypto?.getRandomValues) {
    const bytes = crypto.getRandomValues(new Uint8Array(length));
    for (let i = 0; i < length; i += 1) out[i] = ALPHABET[bytes[i] % ALPHABET.length];
  } else {
    for (let i = 0; i < length; i += 1) out[i] = ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return out.join('');
}

/**
 * Creates a prefixed, human-recognisable, practically-unique id.
 *
 * Format: `<prefix>_<base36 time><random>` — sortable by creation time and
 * readable in exported JSON, e.g. `tch_lz3k9d_a7fq`.
 *
 * @param {string} prefix Short entity tag, e.g. `'tch'`.
 * @returns {string}
 */
export function createId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${randomSuffix(4)}`;
}

/**
 * Creates a deterministic key by joining parts with a separator that cannot
 * appear in an id. Used for the scheduler's O(1) occupancy maps.
 * @param {...(string|number)} parts
 * @returns {string}
 */
export function compositeKey(...parts) {
  return parts.join('');
}
