/**
 * @file SchemaMigrator.js
 * @description Upgrades stored payloads written by older builds.
 *
 * WHY THIS EXISTS BEFORE IT IS NEEDED
 * The moment this app holds a real term's timetable, "the data model changed
 * so we cleared your storage" stops being acceptable. Retrofitting migrations
 * after users have data is far harder than reserving the seam now: today the
 * list is empty and the cost is thirty lines.
 *
 * ADDING A MIGRATION
 *   1. Bump SCHEMA_VERSION in Constants.js.
 *   2. Append `{ from: 1, to: 2, migrate(data, key) { ... return data; } }`.
 * Migrations run in order until the payload reaches the current version.
 */

import { SCHEMA_VERSION } from '../utils/Constants.js';
import { createLogger } from '../utils/Logger.js';

const log = createLogger('SchemaMigrator');

/**
 * @typedef {object} Migration
 * @property {number} from
 * @property {number} to
 * @property {(data: *, key: string) => *} migrate
 */

/**
 * Ordered migration steps. Empty at v1 — the seam matters, not the contents.
 * @type {Migration[]}
 */
const MIGRATIONS = [
  // Example of the shape a future migration takes:
  // {
  //   from: 1,
  //   to: 2,
  //   migrate(data, key) {
  //     if (key !== StorageKeys.TEACHERS) return data;
  //     return data.map((t) => ({ ...t, maxPeriodsPerWeek: t.maxPeriodsPerWeek ?? 30 }));
  //   },
  // },
];

export class SchemaMigrator {
  /**
   * @param {Migration[]} [migrations]
   * @param {number} [targetVersion]
   */
  constructor(migrations = MIGRATIONS, targetVersion = SCHEMA_VERSION) {
    /** @private */
    this._migrations = [...migrations].sort((a, b) => a.from - b.from);
    /** @private */
    this._target = targetVersion;
  }

  /**
   * Brings one stored envelope up to the current schema version.
   *
   * @param {string} key Storage key, so a migration can target one collection.
   * @param {{schemaVersion?: number, data?: *}|null} storedEnvelope
   * @returns {{data: *, migrated: boolean}|null} null when there was nothing stored.
   */
  apply(key, storedEnvelope) {
    if (storedEnvelope === null || storedEnvelope === undefined) return null;

    // Tolerate payloads written before envelopes existed, and hand-edited
    // JSON files that are just the bare array or object.
    const hasEnvelope = typeof storedEnvelope === 'object'
      && !Array.isArray(storedEnvelope)
      && 'data' in storedEnvelope;

    let version = hasEnvelope ? Number(storedEnvelope.schemaVersion ?? 1) : 1;
    let data = hasEnvelope ? storedEnvelope.data : storedEnvelope;
    let migrated = false;

    while (version < this._target) {
      const step = this._migrations.find((migration) => migration.from === version);
      if (!step) {
        log.warn(`No migration from schema v${version} to v${this._target} for "${key}". Using the data as-is.`);
        break;
      }
      log.info(`Migrating "${key}" from v${step.from} to v${step.to}.`);
      data = step.migrate(data, key);
      version = step.to;
      migrated = true;
    }

    if (version > this._target) {
      log.warn(`"${key}" was written by a newer version of ChronoSched (v${version} > v${this._target}). Some fields may be ignored.`);
    }

    return { data, migrated };
  }

  /** @returns {number} */
  get targetVersion() {
    return this._target;
  }
}
