/**
 * @file SubjectRepository.js
 * @description Persistence and integrity rules for the subject catalogue.
 */

import { Repository } from './Repository.js';
import { Subject } from '../../domain/Subject.js';
import { StorageKeys, Events } from '../../utils/Constants.js';

export class SubjectRepository extends Repository {
  /**
   * @param {object} deps
   * @param {import('../DataService.js').DataService} deps.dataService
   * @param {import('../../core/EventBus.js').EventBus} deps.eventBus
   */
  constructor({ dataService, eventBus }) {
    super({
      dataService,
      eventBus,
      storageKey: StorageKeys.SUBJECTS,
      changeEvent: Events.SUBJECTS_CHANGED,
      selector: (schoolData) => schoolData.subjects,
      factory: (data) => new Subject(data),
      label: 'Subject',
    });
  }

  /**
   * @protected
   * @param {Subject} subject
   * @returns {string[]}
   */
  _findConflicts(subject) {
    const clash = this._registry.find((other) => other.id !== subject.id
      && other.name.toLowerCase() === subject.name.toLowerCase());

    return clash ? [`A subject named "${subject.name}" already exists.`] : [];
  }

  /**
   * Blocked while any class still studies it — the same reasoning as teachers:
   * the curriculum rows represent real decisions and should be revisited
   * deliberately, not deleted as a side effect.
   * @protected
   * @param {Subject} subject
   * @returns {string[]}
   */
  _findDependents(subject) {
    const usages = this._schoolData.curriculumForSubject(subject.id);
    if (usages.length === 0) return [];

    const classNames = usages
      .map((entry) => this._schoolData.classes.get(entry.classId)?.name ?? entry.classId)
      .slice(0, 4);
    const extra = usages.length > 4 ? ` and ${usages.length - 4} more` : '';

    return [`${subject.name} is still in the curriculum for ${classNames.join(', ')}${extra}. `
      + 'Remove those curriculum rows first.'];
  }

  /**
   * Teachers who list this subject as a qualification.
   * @param {string} subjectId
   * @returns {import('../../domain/Teacher.js').Teacher[]}
   */
  qualifiedTeachers(subjectId) {
    return this._schoolData.teachers.filter((teacher) => teacher.subjectIds.includes(subjectId));
  }
}
