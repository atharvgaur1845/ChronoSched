/**
 * @file SettingsRepository.js
 * @description Persistence for the single Settings object.
 *
 * Does not extend Repository: that class manages a collection of entities with
 * ids, and settings is one singleton with no id. Forcing it into the generic
 * base would mean a registry of exactly one item and a fake id — more
 * complexity than the ~60 lines it saves.
 */

import { Settings } from '../../domain/Settings.js';
import { StorageKeys, Events } from '../../utils/Constants.js';
import { Result } from '../../core/Result.js';

export class SettingsRepository {
  /**
   * @param {object} deps
   * @param {import('../DataService.js').DataService} deps.dataService
   * @param {import('../../core/EventBus.js').EventBus} deps.eventBus
   */
  constructor({ dataService, eventBus }) {
    /** @private */ this._dataService = dataService;
    /** @private */ this._eventBus = eventBus;
  }

  /** @private @returns {import('../../domain/SchoolData.js').SchoolData} */
  get _schoolData() {
    return this._dataService.schoolData;
  }

  /** @returns {Settings} */
  get() {
    return this._schoolData.settings;
  }

  /** @returns {import('../../domain/TimeGrid.js').TimeGrid} */
  getTimeGrid() {
    return this._schoolData.timeGrid;
  }

  /**
   * Validates and stores new settings, rebuilding the time grid.
   *
   * Changing the grid can strand lessons whose slots no longer exist (reducing
   * periods from 8 to 6 orphans everything in periods 7 and 8). Those lessons
   * are pruned here and reported, rather than left to render as blank cells.
   *
   * @param {Settings} settings
   * @returns {Promise<Result>}
   */
  async save(settings) {
    const validation = settings.validate();
    if (!validation.ok) return validation;

    const previousHash = this._schoolData.settings.geometryHash;
    this._schoolData.applySettings(settings);

    const warnings = [...validation.warnings];
    if (previousHash !== settings.geometryHash) {
      const orphaned = this._pruneOrphanedLessons();
      if (orphaned > 0) {
        warnings.push(`${orphaned} scheduled period(s) fell outside the new school day and were removed. Regenerate to fill the gaps.`);
        await this._dataService.persist(
          StorageKeys.TIMETABLES,
          this._schoolData.timetables.map((item) => item.toJSON()),
        );
        this._eventBus.emit(Events.TIMETABLES_CHANGED, this._schoolData.timetables.toArray());
      }
    }

    await this._dataService.persist(StorageKeys.SETTINGS, settings.toJSON());
    this._eventBus.emit(Events.SETTINGS_CHANGED, settings);

    return Result.ok(settings, warnings);
  }

  /**
   * Updates only the soft-constraint weights.
   * @param {Record<string, number>} weights
   * @returns {Promise<Result>}
   */
  async saveWeights(weights) {
    return this.save(this.get().withChanges({
      constraintWeights: { ...this.get().constraintWeights, ...weights },
    }));
  }

  /**
   * Removes lessons pointing at slots the current grid no longer contains.
   * @private
   * @returns {number} Count of removed lessons.
   */
  _pruneOrphanedLessons() {
    const grid = this._schoolData.timeGrid;
    let removed = 0;

    for (const timetable of this._schoolData.timetables) {
      const surviving = timetable.lessons.filter((lesson) => grid.getSlot(lesson.slotId) !== undefined);
      removed += timetable.lessonCount - surviving.length;
      if (surviving.length !== timetable.lessonCount) timetable.replaceLessons(surviving);
    }
    return removed;
  }
}
