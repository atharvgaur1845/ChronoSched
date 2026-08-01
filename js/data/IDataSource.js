/**
 * @file IDataSource.js
 * @description The seam between the application and wherever its data lives.
 *
 * THIS INTERFACE IS THE WHOLE BACKEND-MIGRATION STORY.
 * Today it is implemented by LocalStorageDataSource. Adding FastAPI later
 * means writing RestDataSource against these four methods and changing one
 * line in main.js. Nothing in `services/`, `ui/` or `domain/` changes.
 *
 * WHY EVERY METHOD IS ASYNC EVEN THOUGH LOCALSTORAGE IS SYNCHRONOUS
 * If these returned plain values, every call site would be written
 * synchronously, and swapping in an HTTP source later would mean rewriting
 * all of them. `async` on a synchronous implementation costs one microtask
 * and buys the entire migration.
 *
 * JavaScript has no interfaces, so this is an abstract class whose methods
 * throw. A subclass that forgets one fails loudly on first use rather than
 * returning undefined.
 */

export class IDataSource {
  constructor() {
    if (new.target === IDataSource) {
      throw new TypeError('IDataSource is an interface and cannot be instantiated.');
    }
  }

  /**
   * Human-readable name, shown in diagnostics.
   * @returns {string}
   */
  get name() {
    return this.constructor.name;
  }

  /**
   * Whether this source accepts writes. Seed data is read-only.
   * @returns {boolean}
   */
  get isWritable() {
    return true;
  }

  /**
   * Loads one stored payload.
   * @abstract
   * @param {string} _key One of {@link import('../utils/Constants.js').StorageKeys}.
   * @returns {Promise<object|null>} The envelope `{schemaVersion, data}`, or null.
   */
  async load(_key) {
    throw new Error(`${this.constructor.name} must implement load(key).`);
  }

  /**
   * Persists one payload.
   * @abstract
   * @param {string} _key
   * @param {object} _envelope `{schemaVersion, data}`.
   * @returns {Promise<boolean>} True when the write succeeded.
   */
  async save(_key, _envelope) {
    throw new Error(`${this.constructor.name} must implement save(key, envelope).`);
  }

  /**
   * Deletes one payload.
   * @abstract
   * @param {string} _key
   * @returns {Promise<void>}
   */
  async remove(_key) {
    throw new Error(`${this.constructor.name} must implement remove(key).`);
  }

  /**
   * Whether a payload exists without loading it.
   * @param {string} key
   * @returns {Promise<boolean>}
   */
  async has(key) {
    return (await this.load(key)) !== null;
  }
}

/**
 * Wraps a payload in the standard storage envelope.
 * Every source stores the same shape, so the migrator only has to understand
 * one thing.
 *
 * @param {number} schemaVersion
 * @param {*} data
 * @returns {{schemaVersion: number, data: *}}
 */
export function envelope(schemaVersion, data) {
  return { schemaVersion, data };
}
