/**
 * @file Registry.js
 * @description An insertion-ordered, id-keyed collection with O(1) lookup.
 *
 * A plain array would make `getById` an O(n) scan, and the scheduler calls it
 * inside its innermost loop. A plain Map would lose the stable display order
 * users expect in tables. This gives both: Map semantics with Array iteration
 * order (which the JS spec guarantees for Map).
 *
 * @template {{id: string}} T
 */
export class Registry {
  /**
   * @param {T[]} [items] Initial contents.
   */
  constructor(items = []) {
    /** @private @type {Map<string, T>} */
    this._items = new Map();
    for (const item of items) this._items.set(item.id, item);
  }

  /** @returns {number} */
  get size() {
    return this._items.size;
  }

  /**
   * @param {string} id
   * @returns {T|undefined}
   */
  get(id) {
    return this._items.get(id);
  }

  /**
   * @param {string} id
   * @returns {boolean}
   */
  has(id) {
    return this._items.has(id);
  }

  /**
   * Inserts or replaces an item.
   * @param {T} item
   * @returns {T}
   */
  set(item) {
    this._items.set(item.id, item);
    return item;
  }

  /**
   * @param {string} id
   * @returns {boolean} True when something was removed.
   */
  delete(id) {
    return this._items.delete(id);
  }

  /** Empties the registry. */
  clear() {
    this._items.clear();
  }

  /**
   * All items in insertion order. Returns a fresh array so callers cannot
   * mutate internal state by accident.
   * @returns {T[]}
   */
  toArray() {
    return [...this._items.values()];
  }

  /**
   * @param {(item: T) => boolean} predicate
   * @returns {T[]}
   */
  filter(predicate) {
    return this.toArray().filter(predicate);
  }

  /**
   * @param {(item: T) => boolean} predicate
   * @returns {T|undefined}
   */
  find(predicate) {
    for (const item of this._items.values()) if (predicate(item)) return item;
    return undefined;
  }

  /**
   * @template R
   * @param {(item: T, index: number) => R} transform
   * @returns {R[]}
   */
  map(transform) {
    return this.toArray().map(transform);
  }

  /**
   * Replaces the entire contents in one operation.
   * @param {T[]} items
   */
  replaceAll(items) {
    this._items.clear();
    for (const item of items) this._items.set(item.id, item);
  }

  /** @returns {IterableIterator<T>} */
  [Symbol.iterator]() {
    return this._items.values();
  }
}
