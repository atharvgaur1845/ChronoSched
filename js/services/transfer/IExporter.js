/**
 * @file IExporter.js
 * @description Interface every export format implements.
 *
 * One interface across Excel, PDF and JSON means the UI has a single "Export"
 * menu built by iterating the registered exporters. Adding CSV or iCal later is
 * a new class plus one registration line — no view changes.
 */

import { Result } from '../../core/Result.js';
import { downloadBlob } from '../../utils/DomUtils.js';

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
   * True when this exporter's machinery is present at all — its library
   * loaded, essentially.
   *
   * Deliberately NOT "can it succeed right now". A button disabled because of
   * missing data is a button that does nothing when clicked, and the user is
   * left guessing. Preconditions belong in {@link unavailableReason}, which
   * produces a sentence the user can act on.
   *
   * @param {object} _payload
   * @returns {boolean}
   */
  isAvailable(_payload) { return true; }

  /**
   * Why this exporter cannot produce anything useful from the current data,
   * or null when it can.
   *
   * The UI keeps the button clickable and surfaces this on click, so the
   * answer to "why did nothing happen?" is always on screen.
   *
   * @param {object} _payload
   * @returns {string|null}
   */
  unavailableReason(_payload) { return null; }

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

  /**
   * Delivers a finished file to the user.
   *
   * Every exporter routes through this one anchor-click rather than each
   * library's own save helper. SheetJS `writeFile` and jsPDF `save` each
   * reimplement the download differently and each has its own browser quirks;
   * funnelling all three formats through a single tested path means a download
   * that works for JSON works identically for Excel and PDF.
   *
   * @protected
   * @param {Blob} blob
   * @param {string} filename
   */
  _deliver(blob, filename) {
    downloadBlob(blob, filename);
  }
}
