/**
 * @file RestDataSource.js
 * @description A working HTTP implementation of {@link IDataSource}, provided
 * as the migration path to a FastAPI + PostgreSQL backend.
 *
 * NOT WIRED INTO THE APPLICATION. Nothing imports it, and it is not referenced
 * from main.js. It exists to keep the promise in docs/ARCHITECTURE.md §9
 * honest: the backend swap really is one line, and this file is the proof
 * rather than an assurance.
 *
 * To adopt it, change one line in js/main.js:
 *
 *     const primary = new LocalStorageDataSource(storage);
 *     // becomes
 *     const primary = new RestDataSource({ baseUrl: 'https://api.example.com' });
 *
 * Nothing in domain/, scheduling/, services/ or ui/ changes, because every
 * data method has been async since the first commit and no caller knows which
 * implementation it was handed.
 *
 * A matching FastAPI service needs four routes:
 *
 *     GET    /state/{key}   → 200 {schemaVersion, data} | 404
 *     PUT    /state/{key}   ← {schemaVersion, data}     → 204
 *     DELETE /state/{key}                                → 204
 *     HEAD   /state/{key}                                → 200 | 404
 *
 * where `key` is a storage key from Constants.StorageKeys with the
 * `chronosched:v1:` prefix stripped.
 */

import { IDataSource } from './IDataSource.js';
import { STORAGE_PREFIX } from '../utils/Constants.js';
import { createLogger } from '../utils/Logger.js';

const log = createLogger('RestDataSource');

/** Requests that hang longer than this are abandoned. */
const DEFAULT_TIMEOUT_MS = 10_000;

export class RestDataSource extends IDataSource {
  /**
   * @param {object} options
   * @param {string} options.baseUrl        e.g. `'https://api.example.com'`.
   * @param {string} [options.path]         Collection path. Defaults to `/state`.
   * @param {() => (string|null)} [options.getAuthToken] Bearer token supplier.
   * @param {number} [options.timeoutMs]
   */
  constructor({ baseUrl, path = '/state', getAuthToken = () => null, timeoutMs = DEFAULT_TIMEOUT_MS }) {
    super();
    /** @private */ this._baseUrl = baseUrl.replace(/\/+$/, '');
    /** @private */ this._path = path;
    /** @private */ this._getAuthToken = getAuthToken;
    /** @private */ this._timeoutMs = timeoutMs;
  }

  /** @returns {string} */
  get name() {
    return `REST (${this._baseUrl})`;
  }

  /** @returns {boolean} */
  get isWritable() {
    return true;
  }

  /**
   * Storage keys carry a `chronosched:v1:` prefix that is meaningful only to
   * the browser. The server sees `teachers`, not `chronosched:v1:teachers`.
   * @private
   * @param {string} key
   * @returns {string}
   */
  _url(key) {
    const bare = key.startsWith(`${STORAGE_PREFIX}:`) ? key.slice(STORAGE_PREFIX.length + 1) : key;
    return `${this._baseUrl}${this._path}/${encodeURIComponent(bare)}`;
  }

  /**
   * @private
   * @param {string} url
   * @param {RequestInit} init
   * @returns {Promise<Response>}
   */
  async _request(url, init = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this._timeoutMs);
    const token = this._getAuthToken();

    try {
      return await fetch(url, {
        ...init,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...init.headers,
        },
      });
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * A missing key is `null`, exactly as it is for LocalStorage — a 404 here
   * means "nothing stored yet", not an error. Treating it as an error would
   * make first run fail on a fresh database.
   *
   * @param {string} key
   * @returns {Promise<object|null>}
   */
  async load(key) {
    try {
      const response = await this._request(this._url(key));
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      log.error(`Could not load "${key}".`, error);
      // Returning null rather than rethrowing keeps a network blip from
      // blocking startup; DataService falls through to the seed data.
      return null;
    }
  }

  /**
   * @param {string} key
   * @param {object} envelope
   * @returns {Promise<boolean>}
   */
  async save(key, envelope) {
    try {
      const response = await this._request(this._url(key), {
        method: 'PUT',
        body: JSON.stringify(envelope),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return true;
    } catch (error) {
      log.error(`Could not save "${key}".`, error);
      return false;
    }
  }

  /**
   * @param {string} key
   * @returns {Promise<void>}
   */
  async remove(key) {
    try {
      await this._request(this._url(key), { method: 'DELETE' });
    } catch (error) {
      log.error(`Could not delete "${key}".`, error);
    }
  }

  /**
   * @param {string} key
   * @returns {Promise<boolean>}
   */
  async has(key) {
    try {
      const response = await this._request(this._url(key), { method: 'HEAD' });
      return response.ok;
    } catch {
      return false;
    }
  }
}
