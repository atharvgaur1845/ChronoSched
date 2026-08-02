/**
 * @file TransferService.js
 * @description Single entry point for every import and export.
 *
 * Views ask for `exporters` and get a list to build a menu from; they call
 * `runExport(id, …)` and get a Result. Adding CSV or iCal means registering one
 * more class here — no view changes. That is the Factory/registry pattern doing
 * exactly the job it is meant for.
 */

import { Result } from '../../core/Result.js';
import { ExcelExporter } from './ExcelExporter.js';
import { PdfExporter } from './PdfExporter.js';
import { JsonExporter, JsonImporter } from './JsonTransfer.js';
import { ExcelImporter } from './ExcelImporter.js';
import { Events } from '../../utils/Constants.js';
import { createLogger } from '../../utils/Logger.js';

const log = createLogger('TransferService');

export class TransferService {
  /**
   * @param {object} deps
   * @param {import('../../data/DataService.js').DataService} deps.dataService
   * @param {import('../../core/EventBus.js').EventBus} deps.eventBus
   * @param {object} deps.repositories
   */
  constructor({ dataService, eventBus, repositories }) {
    /** @private */ this._dataService = dataService;
    /** @private */ this._eventBus = eventBus;
    /** @private */ this._repositories = repositories;

    /** @private @type {Map<string, import('./IExporter.js').IExporter>} */
    this._exporters = new Map(
      [new ExcelExporter(), new PdfExporter(), new JsonExporter()].map((item) => [item.id, item]),
    );

    /** @private */ this._excelImporter = new ExcelImporter();
    /** @private */ this._jsonImporter = new JsonImporter();
  }

  /**
   * Export formats, each with the reason it cannot run right now (or null).
   *
   * `blockedReason` rather than a boolean: the UI keeps the button live and
   * says why on click, instead of presenting a disabled control that appears
   * broken.
   *
   * @param {object} payload
   * @returns {Array<{id: string, label: string, description: string, blockedReason: string|null}>}
   */
  listExporters(payload) {
    return [...this._exporters.values()].map((exporter) => ({
      id: exporter.id,
      label: exporter.label,
      description: exporter.description,
      blockedReason: exporter.unavailableReason(payload),
    }));
  }

  /**
   * Runs one export.
   * @param {string} exporterId
   * @param {object} payload
   * @returns {Promise<Result>}
   */
  async runExport(exporterId, payload) {
    const exporter = this._exporters.get(exporterId);
    if (!exporter) return Result.fail(`Unknown export format "${exporterId}".`);

    try {
      return await exporter.export(payload);
    } catch (error) {
      log.error(`Export "${exporterId}" threw.`, error);
      return Result.fail(`Export failed: ${error.message}`);
    }
  }

  /**
   * Parses a file for preview. Nothing is written yet.
   * @param {File} file
   * @returns {Promise<Result>} `value` carries `{ format, ... }`.
   */
  async parseImport(file) {
    const isJson = /\.json$/i.test(file.name) || file.type === 'application/json';

    if (isJson) {
      const result = await this._jsonImporter.parse(file);
      return result.ok ? Result.ok({ format: 'json', ...result.value }, result.warnings) : result;
    }

    const result = await this._excelImporter.parse(file, this._dataService.schoolData);
    return result.ok ? Result.ok({ format: 'xlsx', ...result.value }, result.warnings) : result;
  }

  /**
   * Applies a previously parsed JSON backup, replacing everything.
   * @param {object} payload SchoolData-shaped payload from {@link parseImport}.
   * @returns {Promise<Result>}
   */
  async commitJsonImport(payload) {
    try {
      await this._dataService.replaceAll(payload);
      return Result.ok('All data was replaced from the backup.');
    } catch (error) {
      log.error('JSON import failed.', error);
      return Result.fail(`Import failed: ${error.message}`);
    }
  }

  /**
   * Applies parsed spreadsheet entities.
   *
   * Merge, not replace: rows that matched an existing record by name keep their
   * id and are updated, and anything absent from the workbook is left alone.
   * Wiping unmentioned records would make a partial spreadsheet destructive,
   * which is never what someone importing a teacher list intends.
   *
   * @param {object} entities From {@link parseImport}.
   * @returns {Promise<Result>}
   */
  async commitExcelImport(entities) {
    const schoolData = this._dataService.schoolData;
    const counts = { classes: 0, subjects: 0, teachers: 0, curriculum: 0 };

    // Order matters — curriculum rows reference the other three.
    for (const item of entities.classes ?? []) { schoolData.classes.set(item); counts.classes += 1; }
    for (const item of entities.subjects ?? []) { schoolData.subjects.set(item); counts.subjects += 1; }
    for (const item of entities.teachers ?? []) { schoolData.teachers.set(item); counts.teachers += 1; }
    for (const item of entities.curriculum ?? []) { schoolData.curriculum.set(item); counts.curriculum += 1; }

    await this._dataService.persistAll();

    this._eventBus.emit(Events.CLASSES_CHANGED, schoolData.classes.toArray());
    this._eventBus.emit(Events.SUBJECTS_CHANGED, schoolData.subjects.toArray());
    this._eventBus.emit(Events.TEACHERS_CHANGED, schoolData.teachers.toArray());
    this._eventBus.emit(Events.CURRICULUM_CHANGED, schoolData.curriculum.toArray());

    const parts = Object.entries(counts)
      .filter(([, value]) => value > 0)
      .map(([key, value]) => `${value} ${key}`);

    return Result.ok(parts.length > 0 ? `Imported ${parts.join(', ')}.` : 'Nothing was imported.');
  }

  /** @returns {string} Accept attribute for the file picker. */
  get acceptedFileTypes() {
    return `${this._excelImporter.accept},${this._jsonImporter.accept}`;
  }
}
