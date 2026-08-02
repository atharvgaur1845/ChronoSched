/**
 * @file JsonTransfer.js
 * @description Full-fidelity backup and restore.
 *
 * Excel is for humans editing data; JSON is for moving the *whole application
 * state* — including generated timetable versions and their reports — between
 * browsers or machines. It is the only format that round-trips losslessly, and
 * therefore the one the Settings screen recommends for backups.
 */

import { IExporter } from './IExporter.js';
import { Result } from '../../core/Result.js';
import { SCHEMA_VERSION } from '../../utils/Constants.js';

/** Marker so a foreign JSON file is rejected with a clear message. */
const FILE_KIND = 'chronosched-backup';

export class JsonExporter extends IExporter {
  /** @returns {string} */ get id() { return 'json'; }
  /** @returns {string} */ get label() { return 'JSON backup'; }
  /** @returns {string} */ get extension() { return 'json'; }

  /** @returns {string} */
  get description() {
    return 'Complete backup including every timetable version. Use this to move data to another computer.';
  }

  /**
   * @param {object} payload
   * @param {import('../../domain/SchoolData.js').SchoolData} payload.schoolData
   * @returns {Promise<Result>}
   */
  async export({ schoolData }) {
    const document = {
      kind: FILE_KIND,
      schemaVersion: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      school: schoolData.settings.school,
      data: schoolData.toJSON(),
    };

    this._deliver(
      new Blob([JSON.stringify(document, null, 2)], { type: 'application/json' }),
      this._filename(`chronosched-${schoolData.settings.school.name}`),
    );

    return Result.ok(`Exported ${schoolData.counts.timetables} timetable version(s) and all school data.`);
  }
}

export class JsonImporter {
  /** @returns {string} */ get id() { return 'json'; }
  /** @returns {string} */ get label() { return 'JSON backup'; }
  /** @returns {string} */ get accept() { return '.json,application/json'; }

  /**
   * Parses and validates a backup file.
   *
   * Returns the payload rather than applying it, so the UI can show the user
   * what is about to replace their data and ask for confirmation. An import
   * that silently overwrites a term's work is not acceptable.
   *
   * @param {File} file
   * @returns {Promise<Result>} On success, `value` is the SchoolData payload.
   */
  async parse(file) {
    let document;
    try {
      document = JSON.parse(await file.text());
    } catch (error) {
      return Result.fail(`"${file.name}" is not valid JSON. ${error.message}`);
    }

    // Tolerate a bare SchoolData payload as well as a wrapped backup, because
    // people hand-edit these and drop the wrapper.
    const payload = document?.kind === FILE_KIND ? document.data : document;

    if (!payload || typeof payload !== 'object') {
      return Result.fail('That file does not contain ChronoSched data.');
    }
    const expected = ['settings', 'classes', 'subjects', 'teachers', 'curriculum'];
    const missing = expected.filter((key) => !(key in payload));
    if (missing.length === expected.length) {
      return Result.fail('That file does not look like a ChronoSched backup — no school data was found in it.');
    }

    const warnings = [];
    if (missing.length > 0) {
      warnings.push(`The file has no ${missing.join(', ')} — those will be left empty.`);
    }
    if (document?.schemaVersion && document.schemaVersion > SCHEMA_VERSION) {
      warnings.push(`This backup was made by a newer version of ChronoSched (v${document.schemaVersion}). Some fields may be ignored.`);
    }

    const summary = {
      classes: payload.classes?.length ?? 0,
      subjects: payload.subjects?.length ?? 0,
      teachers: payload.teachers?.length ?? 0,
      curriculum: payload.curriculum?.length ?? 0,
      timetables: payload.timetables?.length ?? 0,
    };

    return Result.ok({ payload, summary }, warnings);
  }
}
