/**
 * @file LocalStorageDataSource.js
 * @description The live, writable data source: the browser's LocalStorage.
 *
 * All the awkward parts of Web Storage (quota errors, private-browsing denial,
 * corrupted JSON) are already handled by StorageManager, so this class is a
 * thin adapter — which is exactly how an adapter should look.
 */

import { IDataSource } from './IDataSource.js';

export class LocalStorageDataSource extends IDataSource {
  /**
   * @param {import('../managers/StorageManager.js').StorageManager} storage
   */
  constructor(storage) {
    super();
    /** @private */
    this._storage = storage;
  }

  /** @returns {string} */
  get name() {
    return this._storage.isPersistent ? 'LocalStorage' : 'Memory (not persistent)';
  }

  /** @returns {boolean} */
  get isWritable() {
    return true;
  }

  /**
   * @param {string} key
   * @returns {Promise<object|null>}
   */
  async load(key) {
    return this._storage.getJSON(key, null);
  }

  /**
   * @param {string} key
   * @param {object} envelopeValue
   * @returns {Promise<boolean>}
   */
  async save(key, envelopeValue) {
    return this._storage.setJSON(key, envelopeValue);
  }

  /**
   * @param {string} key
   * @returns {Promise<void>}
   */
  async remove(key) {
    this._storage.remove(key);
  }

  /**
   * @param {string} key
   * @returns {Promise<boolean>}
   */
  async has(key) {
    return this._storage.has(key);
  }
}
