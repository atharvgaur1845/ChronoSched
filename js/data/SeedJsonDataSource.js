/**
 * @file SeedJsonDataSource.js
 * @description Read-only source backed by the JSON files shipped with the build.
 *
 * Used exactly once per browser: on first run, to give the administrator a
 * populated school to explore instead of six empty screens. After that
 * LocalStorage is authoritative and these files are ignored, unless the user
 * explicitly chooses "Restore demo data" in Settings.
 *
 * NOTE ON `file://`: fetch() of a local JSON file is blocked by the browser's
 * CORS rules when the page is opened directly from disk. The app must be served
 * over http — see README. Failing to load a seed is treated as "no seed", not
 * as an error, so the app still boots into an empty but usable state.
 */

import { IDataSource } from './IDataSource.js';
import { SEED_PATHS } from '../utils/Constants.js';
import { createLogger } from '../utils/Logger.js';

const log = createLogger('SeedJsonDataSource');

export class SeedJsonDataSource extends IDataSource {
  /**
   * @param {Record<string,string>} [paths] Storage key → file path.
   */
  constructor(paths = SEED_PATHS) {
    super();
    /** @private @type {Record<string,string>} */
    this._paths = paths;
    /** @private @type {Map<string, object|null>} Avoids re-fetching a file. */
    this._cache = new Map();
  }

  /** @returns {string} */
  get name() {
    return 'Seed JSON';
  }

  /** @returns {boolean} */
  get isWritable() {
    return false;
  }

  /**
   * @param {string} key
   * @returns {Promise<object|null>}
   */
  async load(key) {
    if (this._cache.has(key)) return this._cache.get(key) ?? null;

    const path = this._paths[key];
    if (!path) {
      this._cache.set(key, null);
      return null;
    }

    try {
      const response = await fetch(path, { cache: 'no-cache' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      this._cache.set(key, payload);
      return payload;
    } catch (error) {
      log.warn(`Could not load seed "${path}" (${error.message}). Starting empty for this collection.`);
      this._cache.set(key, null);
      return null;
    }
  }

  /**
   * Seeds are part of the build, not user data.
   * @returns {Promise<boolean>}
   */
  async save() {
    throw new Error('SeedJsonDataSource is read-only. Save to the primary source instead.');
  }

  /** @returns {Promise<void>} */
  async remove() {
    throw new Error('SeedJsonDataSource is read-only.');
  }

  /** Clears the fetch cache so "Restore demo data" re-reads from disk. */
  invalidate() {
    this._cache.clear();
  }
}
