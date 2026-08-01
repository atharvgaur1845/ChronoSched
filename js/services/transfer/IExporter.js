/**
 * @file IExporter.js
 * @description Interface every export format implements.
 *
 * One interface across Excel, PDF and JSON means the UI has a single "Export"
 * menu built by iterating the registered exporters. Adding CSV or iCal later is
 * a new class plus one registration line — no view changes.
 */

import { Result } from '../../core/Result.js';

export class IExporter {
  constructor() {
    if (new.target === IExporter) {
      throw new TypeError('IExporter is an interface and cannot be instantiated.');
    }
  }

  /** @abstract @returns {string} Stable id, e.g. `'xlsx'`. */
  get id() { throw new Error(`${this.constructor.name} must implement get id().`); }

  /** @abstract @returns {string} Menu label. */
  get label() { throw new Error(`${this.constructor.name} must implement get label().`); }

  /** @abstract @returns {string} File extension without the dot. */
  get extension() { throw new Error(`${this.constructor.name} must implement get extension().`); }

  /** @returns {string} One-line description shown under the menu item. */
  get description() { return ''; }

  /**
   * True when this exporter can run right now (e.g. its library loaded, and
   * there is a timetable to export).
   * @param {object} _payload
   * @returns {boolean}
   */
  isAvailable(_payload) { return true; }

  /**
   * Produces and downloads the file.
   * @abstract
   * @param {object} _payload
   * @param {import('../../domain/SchoolData.js').SchoolData} _payload.schoolData
   * @param {import('../../domain/Timetable.js').Timetable|null} _payload.timetable
   * @param {object} [_payload.options]
   * @returns {Promise<Result>}
   */
  async export(_payload) {
    throw new Error(`${this.constructor.name} must implement export().`);
  }

  /**
   * Builds a safe, dated filename.
   * @protected
   * @param {string} base
   * @returns {string}
   */
  _filename(base) {
    const stamp = new Date().toISOString().slice(0, 10);
    const safe = base.replace(/[^\w\-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    return `${safe}-${stamp}.${this.extension}`;
  }
}
