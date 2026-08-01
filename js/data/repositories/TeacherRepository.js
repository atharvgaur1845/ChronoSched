/**
 * @file TeacherRepository.js
 * @description Persistence and integrity rules for teaching staff.
 */

import { Repository } from './Repository.js';
import { Teacher } from '../../domain/Teacher.js';
import { StorageKeys, Events } from '../../utils/Constants.js';

export class TeacherRepository extends Repository {
  /**
   * @param {object} deps
   * @param {import('../DataService.js').DataService} deps.dataService
   * @param {import('../../core/EventBus.js').EventBus} deps.eventBus
   */
  constructor({ dataService, eventBus }) {
    super({
      dataService,
      eventBus,
      storageKey: StorageKeys.TEACHERS,
      changeEvent: Events.TEACHERS_CHANGED,
      selector: (schoolData) => schoolData.teachers,
      factory: (data) => new Teacher(data),
      label: 'Teacher',
    });
  }

  /**
   * Employee ids must be unique when supplied — they are how the school
   * identifies staff in every other system, and duplicates make an Excel
   * import ambiguous.
   * @protected
   * @param {Teacher} teacher
   * @returns {string[]}
   */
  _findConflicts(teacher) {
    if (!teacher.employeeId) return [];

    const clash = this._registry.find((other) => other.id !== teacher.id
      && other.employeeId.toLowerCase() === teacher.employeeId.toLowerCase());

    return clash ? [`Employee ID "${teacher.employeeId}" is already used by ${clash.name}.`] : [];
  }

  /**
   * A teacher assigned to curriculum rows cannot simply vanish — the rows would
   * point at nothing. The administrator is told exactly which rows to fix.
   * @protected
   * @param {Teacher} teacher
   * @returns {string[]}
   */
  _findDependents(teacher) {
    const assignments = this._schoolData.curriculumForTeacher(teacher.id);
    if (assignments.length === 0) return [];

    const names = assignments.slice(0, 3).map((entry) => {
      const subject = this._schoolData.subjects.get(entry.subjectId)?.name ?? entry.subjectId;
      const schoolClass = this._schoolData.classes.get(entry.classId)?.name ?? entry.classId;
      return `${subject} for ${schoolClass}`;
    });
    const extra = assignments.length > 3 ? ` and ${assignments.length - 3} more` : '';

    return [`${teacher.name} is still assigned to ${names.join(', ')}${extra}. `
      + 'Reassign or clear those curriculum rows first.'];
  }

  /**
   * Teachers qualified for a subject, optionally narrowed to a class.
   * @param {string} subjectId
   * @param {string} [classId]
   * @returns {Teacher[]}
   */
  findQualified(subjectId, classId) {
    return this._registry.filter((teacher) => (classId
      ? teacher.canTeach(subjectId, classId)
      : teacher.subjectIds.includes(subjectId)));
  }

  /**
   * Weekly periods already promised to each teacher by the curriculum, next to
   * their declared cap. Powers the dashboard's over-allocation warning.
   * @returns {Array<{teacher: Teacher, committed: number, capacity: number, overloaded: boolean}>}
   */
  workloadSummary() {
    return this._registry.map((teacher) => {
      const committed = this._schoolData.committedLoadForTeacher(teacher.id);
      return {
        teacher,
        committed,
        capacity: teacher.maxPeriodsPerWeek,
        overloaded: committed > teacher.maxPeriodsPerWeek,
      };
    });
  }
}
