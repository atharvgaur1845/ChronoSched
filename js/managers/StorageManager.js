/**
 * @file StorageManager.js
 * @description A safe, JSON-aware wrapper around Web Storage.
 *
 * Raw `localStorage` throws in three situations this app will genuinely meet:
 * Safari private browsing (access denied), a full quota (QuotaExceededError),
 * and corrupted JSON left by an interrupted write. Each of those, unhandled,
 * is a blank screen. Every access therefore goes through here, which degrades
 * to an in-memory Map so the app stays usable even when nothing can be saved.
 */

import { createLogger } from '../utils/Logger.js';

const log = createLogger('StorageManager');

export class StorageManager {
  /**
   * @param {Storage} [backing] Injectable for tests; defaults to localStorage.
   */
  constructor(backing = undefined) {
    /** @private @type {Storage|Map<string,string>} */
    this._store = backing ?? StorageManager._resolveBacking();
    /** @type {boolean} False when persistence is unavailable this session. */
    this.isPersistent = !(this._store instanceof Map);
  }

  /**
   * Probes localStorage with a real write, because merely checking that the
   * object exists does not detect private-browsing denial.
   * @private
   * @returns {Storage|Map<string,string>}
   */
  static _resolveBacking() {
    try {
      const probe = '__chronosched_probe__';
      window.localStorage.setItem(probe, '1');
      window.localStorage.removeItem(probe);
      return window.localStorage;
    } catch (error) {
      log.warn('localStorage unavailable — falling back to in-memory storage. Changes will not survive a refresh.', error);
      return new Map();
    }
  }

  /**
   * @private
   * @param {string} key
   * @returns {string|null}
   */
  _read(key) {
    return this._store instanceof Map ? (this._store.get(key) ?? null) : this._store.getItem(key);
  }

  /**
   * @private
   * @param {string} key
   * @param {string} value
   */
  _write(key, value) {
    if (this._store instanceof Map) this._store.set(key, value);
    else this._store.setItem(key, value);
  }

  /**
   * Reads and parses a JSON value.
   * @param {string} key
   * @param {*} [fallback] Returned when missing or unparseable.
   * @returns {*}
   */
  getJSON(key, fallback = null) {
    const raw = this._read(key);
    if (raw === null) return fallback;
    try {
      return JSON.parse(raw);
    } catch (error) {
      log.error(`Corrupted JSON at "${key}" — ignoring it and using the fallback.`, error);
      return fallback;
    }
  }

  /**
   * Serialises and writes a value.
   * @param {string} key
   * @param {*} value
   * @returns {boolean} False when the write failed (quota, denial).
   */
  setJSON(key, value) {
    try {
      this._write(key, JSON.stringify(value));
      return true;
    } catch (error) {
      const isQuota = error instanceof DOMException
        && (error.name === 'QuotaExceededError' || error.code === 22);
      log.error(isQuota
        ? `Storage quota exceeded while saving "${key}". Delete old timetable versions to free space.`
        : `Failed to save "${key}".`, error);
      return false;
    }
  }

  /**
   * @param {string} key
   */
  remove(key) {
    if (this._store instanceof Map) this._store.delete(key);
    else this._store.removeItem(key);
  }

  /**
   * @param {string} key
   * @returns {boolean}
   */
  has(key) {
    return this._read(key) !== null;
  }

  /**
   * Every key currently stored under the given prefix.
   * @param {string} prefix
   * @returns {string[]}
   */
  keysWithPrefix(prefix) {
    const keys = this._store instanceof Map
      ? [...this._store.keys()]
      : Object.keys(this._store);
    return keys.filter((key) => key.startsWith(prefix));
  }

  /**
   * Removes every key under a prefix. Used by "reset all data".
   * @param {string} prefix
   * @returns {number} How many keys were removed.
   */
  clearPrefix(prefix) {
    const keys = this.keysWithPrefix(prefix);
    for (const key of keys) this.remove(key);
    return keys.length;
  }

  /**
   * Approximate bytes used by this app's keys, for the Settings screen.
   * @param {string} prefix
   * @returns {number}
   */
  estimateBytes(prefix) {
    let total = 0;
    for (const key of this.keysWithPrefix(prefix)) {
      total += key.length + (this._read(key)?.length ?? 0);
    }
    // UTF-16 code units → bytes.
    return total * 2;
  }
}
