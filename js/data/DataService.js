/**
 * @file DataService.js
 * @description Owns the load/persist lifecycle and the source-of-truth policy.
 *
 * THE POLICY, IN ONE PLACE
 *   First run  — seeds are read, validated, hydrated, then written to storage.
 *   Later runs — storage is authoritative; seeds are never consulted again.
 *   Reset      — only an explicit administrator action re-reads the seeds.
 *
 * Keeping that rule here (rather than sprinkled through repositories) means
 * there is exactly one answer to "where did this data come from?".
 */

import { StorageKeys, SCHEMA_VERSION, Events } from '../utils/Constants.js';
import { SchoolData } from '../domain/SchoolData.js';
import { envelope } from './IDataSource.js';
import { createLogger } from '../utils/Logger.js';

const log = createLogger('DataService');

/** Collections loaded at boot, in dependency order. */
const COLLECTION_KEYS = [
  StorageKeys.SETTINGS,
  StorageKeys.CLASSES,
  StorageKeys.SUBJECTS,
  StorageKeys.TEACHERS,
  StorageKeys.CURRICULUM,
  StorageKeys.TIMETABLES,
];

/** Maps a storage key to the SchoolData.hydrate() field it populates. */
const HYDRATE_FIELD = {
  [StorageKeys.SETTINGS]:   'settings',
  [StorageKeys.CLASSES]:    'classes',
  [StorageKeys.SUBJECTS]:   'subjects',
  [StorageKeys.TEACHERS]:   'teachers',
  [StorageKeys.CURRICULUM]: 'curriculum',
  [StorageKeys.TIMETABLES]: 'timetables',
};

export class DataService {
  /**
   * @param {object} deps
   * @param {import('./IDataSource.js').IDataSource} deps.primary Writable source.
   * @param {import('./IDataSource.js').IDataSource} deps.seed    Read-only fallback.
   * @param {import('./SchemaMigrator.js').SchemaMigrator} deps.migrator
   * @param {import('../core/EventBus.js').EventBus} deps.eventBus
   */
  constructor({ primary, seed, migrator, eventBus }) {
    /** @private */ this._primary = primary;
    /** @private */ this._seed = seed;
    /** @private */ this._migrator = migrator;
    /** @private */ this._eventBus = eventBus;

    /** @type {SchoolData} The single in-memory instance the whole app shares. */
    this.schoolData = new SchoolData();

    /** @type {boolean} True when this session populated storage from seeds. */
    this.wasSeeded = false;
  }

  /**
   * Loads everything and returns the populated aggregate.
   * Safe to call once at startup; calling it again reloads from storage.
   *
   * @returns {Promise<SchoolData>}
   */
  async bootstrap() {
    /** @type {Record<string, *>} */
    const payloads = {};
    let seededAnything = false;

    for (const key of COLLECTION_KEYS) {
      const { data, fromSeed } = await this._loadWithFallback(key);
      if (data !== null) payloads[HYDRATE_FIELD[key]] = data;
      if (fromSeed) seededAnything = true;
    }

    const preferences = (await this._primary.load(StorageKeys.PREFERENCES))?.data ?? {};
    if (preferences.activeTimetableId) payloads.activeTimetableId = preferences.activeTimetableId;

    this.schoolData.hydrate(payloads);
    this.wasSeeded = seededAnything;

    // Writing the seeds through immediately means the next refresh is a pure
    // storage read and the user's first edit does not silently sit next to
    // half-loaded seed data.
    if (seededAnything) await this.persistAll();

    log.info(`Loaded ${this.schoolData.counts.classes} classes, `
      + `${this.schoolData.counts.subjects} subjects, `
      + `${this.schoolData.counts.teachers} teachers, `
      + `${this.schoolData.counts.timetables} timetable versions`
      + `${seededAnything ? ' (seeded from demo data)' : ''}.`);

    this._eventBus.emit(Events.DATA_READY, this.schoolData);
    return this.schoolData;
  }

  /**
   * @private
   * @param {string} key
   * @returns {Promise<{data: *, fromSeed: boolean}>}
   */
  async _loadWithFallback(key) {
    const stored = await this._primary.load(key);
    if (stored !== null) {
      const result = this._migrator.apply(key, stored);
      return { data: result?.data ?? null, fromSeed: false };
    }

    const seeded = await this._seed.load(key);
    if (seeded !== null) {
      const result = this._migrator.apply(key, seeded);
      return { data: result?.data ?? null, fromSeed: true };
    }

    return { data: null, fromSeed: false };
  }

  /**
   * Persists a single collection.
   * @param {string} key One of {@link StorageKeys}.
   * @param {*} data Plain JSON-safe payload.
   * @returns {Promise<boolean>}
   */
  async persist(key, data) {
    const ok = await this._primary.save(key, envelope(SCHEMA_VERSION, data));
    if (!ok) {
      this._eventBus.emit(Events.TOAST, {
        level: 'danger',
        message: 'Could not save to browser storage. Your recent change exists only in this tab.',
      });
    }
    return ok;
  }

  /**
   * Writes every collection. Used after seeding, after import, and by backup.
   * @returns {Promise<void>}
   */
  async persistAll() {
    const snapshot = this.schoolData.toJSON();
    await Promise.all([
      this.persist(StorageKeys.SETTINGS, snapshot.settings),
      this.persist(StorageKeys.CLASSES, snapshot.classes),
      this.persist(StorageKeys.SUBJECTS, snapshot.subjects),
      this.persist(StorageKeys.TEACHERS, snapshot.teachers),
      this.persist(StorageKeys.CURRICULUM, snapshot.curriculum),
      this.persist(StorageKeys.TIMETABLES, snapshot.timetables),
      this.persistPreferences({ activeTimetableId: snapshot.activeTimetableId }),
    ]);
  }

  /**
   * Merges and saves UI preferences (theme, active version, last route).
   * Read-modify-write so two callers cannot clobber each other's field.
   * @param {object} patch
   * @returns {Promise<boolean>}
   */
  async persistPreferences(patch) {
    const current = (await this._primary.load(StorageKeys.PREFERENCES))?.data ?? {};
    return this.persist(StorageKeys.PREFERENCES, { ...current, ...patch });
  }

  /** @returns {Promise<object>} */
  async loadPreferences() {
    return (await this._primary.load(StorageKeys.PREFERENCES))?.data ?? {};
  }

  /**
   * Discards all stored data and reloads from the shipped seeds.
   * @returns {Promise<SchoolData>}
   */
  async restoreDemoData() {
    for (const key of [...COLLECTION_KEYS, StorageKeys.PREFERENCES]) {
      await this._primary.remove(key);
    }
    if (typeof this._seed.invalidate === 'function') this._seed.invalidate();

    this.schoolData = new SchoolData();
    return this.bootstrap();
  }

  /**
   * Discards all stored data and starts completely empty.
   * @returns {Promise<SchoolData>}
   */
  async resetToEmpty() {
    for (const key of [...COLLECTION_KEYS, StorageKeys.PREFERENCES]) {
      await this._primary.remove(key);
    }
    this.schoolData = new SchoolData();
    await this.persistAll();
    this._eventBus.emit(Events.DATA_READY, this.schoolData);
    return this.schoolData;
  }

  /**
   * Replaces the entire dataset — the landing point for JSON import.
   * @param {object} payload Same shape as {@link SchoolData#toJSON}.
   * @returns {Promise<SchoolData>}
   */
  async replaceAll(payload) {
    this.schoolData = new SchoolData();
    this.schoolData.hydrate(payload);
    await this.persistAll();
    this._eventBus.emit(Events.DATA_READY, this.schoolData);
    return this.schoolData;
  }

  /** @returns {string} Name of the active primary source, for diagnostics. */
  get sourceName() {
    return this._primary.name;
  }
}
