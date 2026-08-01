/**
 * @file ClassRepository.js
 * @description Persistence and integrity rules for teaching groups.
 */

import { Repository } from './Repository.js';
import { SchoolClass } from '../../domain/SchoolClass.js';
import { StorageKeys, Events } from '../../utils/Constants.js';

export class ClassRepository extends Repository {
  /**
   * @param {object} deps
   * @param {import('../DataService.js').DataService} deps.dataService
   * @param {import('../../core/EventBus.js').EventBus} deps.eventBus
   */
  constructor({ dataService, eventBus }) {
    super({
      dataService,
      eventBus,
      storageKey: StorageKeys.CLASSES,
      changeEvent: Events.CLASSES_CHANGED,
      selector: (schoolData) => schoolData.classes,
      factory: (data) => new SchoolClass(data),
      label: 'Class',
    });
  }

  /**
   * @protected
   * @param {SchoolClass} schoolClass
   * @returns {string[]}
   */
  _findConflicts(schoolClass) {
    const clash = this._registry.find((other) => other.id !== schoolClass.id
      && other.name.toLowerCase() === schoolClass.name.toLowerCase());

    return clash ? [`A class named "${schoolClass.name}" already exists.`] : [];
  }

  /**
   * Deleting a class DOES cascade to its curriculum rows, unlike a teacher
   * delete which is blocked.
   *
   * The asymmetry is intentional: a curriculum row without its class is
   * meaningless and can only be discarded, whereas a row without its teacher
   * is still valid work that simply needs reassigning. Cascading the first and
   * blocking the second is what a careful administrator would do by hand.
   *
   * @protected
   * @param {SchoolClass} schoolClass
   * @returns {Promise<void>}
   */
  async _beforeRemove(schoolClass) {
    const orphans = this._schoolData.curriculumForClass(schoolClass.id);
    for (const entry of orphans) this._schoolData.curriculum.delete(entry.id);

    if (orphans.length > 0) {
      await this._dataService.persist(
        StorageKeys.CURRICULUM,
        this._schoolData.curriculum.map((entry) => entry.toJSON()),
      );
      this._eventBus.emit(Events.CURRICULUM_CHANGED, this._schoolData.curriculum.toArray());
    }

    // Lessons for the deleted class are pruned from every stored version too,
    // otherwise the grid would try to render a class that no longer exists.
    let touchedTimetable = false;
    for (const timetable of this._schoolData.timetables) {
      const remaining = timetable.lessons.filter((lesson) => lesson.classId !== schoolClass.id);
      if (remaining.length !== timetable.lessonCount) {
        timetable.replaceLessons(remaining);
        touchedTimetable = true;
      }
    }
    if (touchedTimetable) {
      await this._dataService.persist(
        StorageKeys.TIMETABLES,
        this._schoolData.timetables.map((item) => item.toJSON()),
      );
      this._eventBus.emit(Events.TIMETABLES_CHANGED, this._schoolData.timetables.toArray());
    }
  }

  /**
   * Weekly demand against grid capacity, per class.
   * A class demanding more periods than the week holds can never be scheduled,
   * so the dashboard surfaces it before the user clicks Generate.
   *
   * @returns {Array<{schoolClass: SchoolClass, demand: number, capacity: number, overbooked: boolean}>}
   */
  capacitySummary() {
    const capacity = this._schoolData.timeGrid.slotCount;
    return this._registry.map((schoolClass) => {
      const demand = this._schoolData.demandForClass(schoolClass.id);
      return { schoolClass, demand, capacity, overbooked: demand > capacity };
    });
  }
}
