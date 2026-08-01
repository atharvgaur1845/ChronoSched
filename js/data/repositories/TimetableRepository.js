/**
 * @file TimetableRepository.js
 * @description Append-only storage for generated timetable versions.
 *
 * THE VERSIONING GUARANTEE
 * `addVersion()` is the only way a generated timetable enters the store, and
 * it always allocates the next version number. There is no code path that
 * overwrites an existing version — which is precisely the brief's requirement
 * that "existing timetables must NEVER be overwritten".
 *
 * Manual edits are different and go through `saveEdits()`, which persists
 * changes to the version the administrator is actively working on. That is a
 * deliberate exception, covered by undo/redo, and it is confined to this file
 * so the distinction cannot leak.
 */

import { Repository } from './Repository.js';
import { Timetable } from '../../domain/Timetable.js';
import { StorageKeys, Events, LIMITS } from '../../utils/Constants.js';
import { Result } from '../../core/Result.js';

export class TimetableRepository extends Repository {
  /**
   * @param {object} deps
   * @param {import('../DataService.js').DataService} deps.dataService
   * @param {import('../../core/EventBus.js').EventBus} deps.eventBus
   */
  constructor({ dataService, eventBus }) {
    super({
      dataService,
      eventBus,
      storageKey: StorageKeys.TIMETABLES,
      changeEvent: Events.TIMETABLES_CHANGED,
      selector: (schoolData) => schoolData.timetables,
      factory: (data) => new Timetable(data),
      label: 'Timetable',
    });
  }

  /** @returns {Timetable[]} Newest first. */
  getAllSorted() {
    return this._schoolData.sortedTimetables;
  }

  /** @returns {Timetable|null} */
  getActive() {
    return this._schoolData.activeTimetable;
  }

  /** @returns {number} */
  get nextVersionNumber() {
    return this._schoolData.nextVersionNumber;
  }

  /**
   * Stores a freshly generated timetable as a new version and makes it active.
   *
   * @param {Timetable} timetable Version number is assigned here, not by the caller.
   * @returns {Promise<Result>} `value` is the stored Timetable.
   */
  async addVersion(timetable) {
    const version = this.nextVersionNumber;
    const stored = new Timetable({
      ...timetable.toJSON(),
      version,
      label: timetable.label?.startsWith('Version ') || !timetable.label
        ? `Version ${version}`
        : timetable.label,
    });

    this._registry.set(stored);

    const warnings = [];
    const pruned = this._pruneOldest();
    if (pruned > 0) {
      warnings.push(`Removed ${pruned} of the oldest version(s) to stay within the ${LIMITS.MAX_TIMETABLE_VERSIONS}-version limit.`);
    }

    this._schoolData.activeTimetableId = stored.id;
    await this._commit();
    await this._dataService.persistPreferences({ activeTimetableId: stored.id });
    this._eventBus.emit(Events.ACTIVE_TIMETABLE, stored);

    return Result.ok(stored, warnings);
  }

  /**
   * Persists in-place edits (drag-and-drop, teacher reassignment) to an
   * existing version. Does NOT create a new version.
   * @param {Timetable} timetable
   * @returns {Promise<Result>}
   */
  async saveEdits(timetable) {
    if (!this._registry.has(timetable.id)) {
      return Result.fail('That timetable version no longer exists.');
    }
    this._registry.set(timetable);
    await this._commit();
    this._eventBus.emit(Events.TIMETABLE_EDITED, timetable);
    return Result.ok(timetable);
  }

  /**
   * Renames a version, e.g. "Version 3" → "Approved — Term 2".
   * @param {string} id
   * @param {string} label
   * @returns {Promise<Result>}
   */
  async rename(id, label) {
    const timetable = this._registry.get(id);
    if (!timetable) return Result.fail('That timetable version no longer exists.');

    const trimmed = String(label).trim();
    if (trimmed.length === 0) return Result.fail('A version name is required.');

    timetable.label = trimmed;
    await this._commit();
    return Result.ok(timetable);
  }

  /**
   * Makes a version the one shown and edited across the app.
   * @param {string} id
   * @returns {Promise<Result>}
   */
  async setActive(id) {
    const timetable = this._registry.get(id);
    if (!timetable) return Result.fail('That timetable version no longer exists.');

    this._schoolData.activeTimetableId = id;
    await this._dataService.persistPreferences({ activeTimetableId: id });
    this._eventBus.emit(Events.ACTIVE_TIMETABLE, timetable);
    return Result.ok(timetable);
  }

  /**
   * Deletes a version. Versions are the one thing the brief allows deleting,
   * so there are no dependents to check — only the active pointer to repair.
   * @param {string} id
   * @returns {Promise<Result>}
   */
  async remove(id) {
    const timetable = this._registry.get(id);
    if (!timetable) return Result.fail('That timetable version no longer exists.');

    this._registry.delete(id);

    if (this._schoolData.activeTimetableId === id) {
      const fallback = this._schoolData.latestTimetable;
      this._schoolData.activeTimetableId = fallback?.id ?? null;
      await this._dataService.persistPreferences({ activeTimetableId: this._schoolData.activeTimetableId });
      this._eventBus.emit(Events.ACTIVE_TIMETABLE, fallback ?? null);
    }

    await this._commit();
    return Result.ok(timetable);
  }

  /**
   * Duplicates a version so an administrator can experiment without risking
   * the approved one.
   * @param {string} id
   * @returns {Promise<Result>}
   */
  async duplicate(id) {
    const source = this._registry.get(id);
    if (!source) return Result.fail('That timetable version no longer exists.');

    const copy = source.cloneAsVersion(this.nextVersionNumber);
    return this.addVersion(copy);
  }

  /**
   * Drops the oldest versions once the cap is exceeded, protecting the
   * LocalStorage quota. Returns how many were removed.
   * @private
   * @returns {number}
   */
  _pruneOldest() {
    const all = this._schoolData.sortedTimetables; // newest first
    if (all.length <= LIMITS.MAX_TIMETABLE_VERSIONS) return 0;

    const doomed = all.slice(LIMITS.MAX_TIMETABLE_VERSIONS);
    for (const timetable of doomed) this._registry.delete(timetable.id);
    return doomed.length;
  }

  /**
   * Cell-by-cell difference between two versions, for the compare screen.
   *
   * @param {string} leftId
   * @param {string} rightId
   * @returns {{added: object[], removed: object[], changed: object[], identical: number}|null}
   */
  diff(leftId, rightId) {
    const left = this._registry.get(leftId);
    const right = this._registry.get(rightId);
    if (!left || !right) return null;

    const leftCells = new Map(left.lessons.map((lesson) => [lesson.cellKey, lesson]));
    const rightCells = new Map(right.lessons.map((lesson) => [lesson.cellKey, lesson]));

    const added = [];
    const removed = [];
    const changed = [];
    let identical = 0;

    for (const [key, rightLesson] of rightCells) {
      const leftLesson = leftCells.get(key);
      if (!leftLesson) {
        added.push({ key, right: rightLesson });
      } else if (leftLesson.subjectId !== rightLesson.subjectId || leftLesson.teacherId !== rightLesson.teacherId) {
        changed.push({ key, left: leftLesson, right: rightLesson });
      } else {
        identical += 1;
      }
    }
    for (const [key, leftLesson] of leftCells) {
      if (!rightCells.has(key)) removed.push({ key, left: leftLesson });
    }

    return { added, removed, changed, identical };
  }
}
