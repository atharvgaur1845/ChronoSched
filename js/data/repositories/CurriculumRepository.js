/**
 * @file CurriculumRepository.js
 * @description Persistence and integrity rules for class↔subject offerings.
 *
 * This is where most real data errors get caught, because a curriculum row is
 * the only entity that references three others (class, subject, teacher).
 */

import { Repository } from './Repository.js';
import { CurriculumEntry } from '../../domain/CurriculumEntry.js';
import { StorageKeys, Events } from '../../utils/Constants.js';
import { Result } from '../../core/Result.js';
import { createId } from '../../utils/IdGenerator.js';

export class CurriculumRepository extends Repository {
  /**
   * @param {object} deps
   * @param {import('../DataService.js').DataService} deps.dataService
   * @param {import('../../core/EventBus.js').EventBus} deps.eventBus
   */
  constructor({ dataService, eventBus }) {
    super({
      dataService,
      eventBus,
      storageKey: StorageKeys.CURRICULUM,
      changeEvent: Events.CURRICULUM_CHANGED,
      selector: (schoolData) => schoolData.curriculum,
      factory: (data) => new CurriculumEntry(data),
      label: 'Curriculum entry',
    });
  }

  /**
   * @protected
   * @param {CurriculumEntry} entry
   * @returns {string[]}
   */
  _findConflicts(entry) {
    const errors = [];
    const schoolData = this._schoolData;

    if (!schoolData.classes.has(entry.classId)) {
      errors.push('The selected class no longer exists.');
    }
    if (!schoolData.subjects.has(entry.subjectId)) {
      errors.push('The selected subject no longer exists.');
    }
    if (entry.teacherId && !schoolData.teachers.has(entry.teacherId)) {
      errors.push('The selected teacher no longer exists.');
    }

    const duplicate = this._registry.find((other) => other.id !== entry.id
      && other.uniquenessKey === entry.uniquenessKey);
    if (duplicate) {
      const className = schoolData.classes.get(entry.classId)?.name ?? entry.classId;
      const subjectName = schoolData.subjects.get(entry.subjectId)?.name ?? entry.subjectId;
      errors.push(`${className} already has a curriculum row for ${subjectName}. Edit that row instead of adding a second one.`);
    }

    // A class cannot study more periods than the week physically contains.
    const capacity = schoolData.timeGrid.slotCount;
    const others = this._registry
      .filter((other) => other.classId === entry.classId && other.id !== entry.id)
      .reduce((total, other) => total + other.periodsPerWeek, 0);

    if (others + entry.periodsPerWeek > capacity) {
      const className = schoolData.classes.get(entry.classId)?.name ?? 'This class';
      errors.push(`${className} would need ${others + entry.periodsPerWeek} periods a week, `
        + `but the timetable only has ${capacity}. Reduce periods or add more periods per day in Time Configuration.`);
    }

    return errors;
  }

  /**
   * Validates without the blocking checks, returning warnings instead.
   * Used by the editor to show live advisories while typing.
   * @param {CurriculumEntry} entry
   * @returns {string[]}
   */
  advisoriesFor(entry) {
    const warnings = [];
    const schoolData = this._schoolData;
    const subject = schoolData.subjects.get(entry.subjectId);
    const teacher = entry.teacherId ? schoolData.teachers.get(entry.teacherId) : null;

    if (teacher && !teacher.subjectIds.includes(entry.subjectId)) {
      warnings.push(`${teacher.name} is not listed as qualified for ${subject?.name ?? 'this subject'}. `
        + 'The timetable will still be generated, but check the teacher record.');
    }
    if (teacher && teacher.classIds.length > 0 && !teacher.classIds.includes(entry.classId)) {
      const className = schoolData.classes.get(entry.classId)?.name ?? 'this class';
      warnings.push(`${teacher.name} is not listed as able to teach ${className}.`);
    }
    if (!entry.teacherId) {
      const pool = schoolData.eligibleTeachersFor(entry);
      if (pool.length === 0) {
        warnings.push('No qualified teacher exists for this subject and class, so these periods cannot be filled.');
      }
    }
    if (teacher) {
      const committed = schoolData.committedLoadForTeacher(teacher.id);
      if (committed > teacher.maxPeriodsPerWeek) {
        warnings.push(`${teacher.name} is now committed to ${committed} periods a week but their limit is ${teacher.maxPeriodsPerWeek}.`);
      }
    }
    if (entry.requiresConsecutive && subject && !subject.isLab) {
      warnings.push('Consecutive periods are usually only needed for labs. Double-check this is intended.');
    }

    return warnings;
  }

  /**
   * Copies every curriculum row from one class to another.
   * Setting up 10B after 10A is otherwise a dozen identical forms.
   *
   * @param {string} sourceClassId
   * @param {string} targetClassId
   * @param {object} [options]
   * @param {boolean} [options.includeTeachers] Carry teacher assignments across.
   * @returns {Promise<Result>} On success, `value` is the number of rows copied.
   */
  async copyToClass(sourceClassId, targetClassId, { includeTeachers = false } = {}) {
    if (sourceClassId === targetClassId) {
      return Result.fail('Source and target class are the same.');
    }
    if (!this._schoolData.classes.has(targetClassId)) {
      return Result.fail('The target class does not exist.');
    }

    const source = this._schoolData.curriculumForClass(sourceClassId);
    if (source.length === 0) return Result.fail('The source class has no curriculum to copy.');

    const existingSubjects = new Set(
      this._schoolData.curriculumForClass(targetClassId).map((entry) => entry.subjectId),
    );

    const copies = source
      .filter((entry) => !existingSubjects.has(entry.subjectId))
      .map((entry) => new CurriculumEntry({
        ...entry.toJSON(),
        id: createId('cur'),
        classId: targetClassId,
        teacherId: includeTeachers ? entry.teacherId : null,
      }));

    if (copies.length === 0) {
      return Result.fail('The target class already has every subject from the source class.');
    }

    for (const copy of copies) this._registry.set(copy);
    await this._commit();

    const skipped = source.length - copies.length;
    const warnings = skipped > 0 ? [`${skipped} subject(s) were skipped because the target class already had them.`] : [];
    return Result.ok(copies.length, warnings);
  }

  /**
   * Removes every row for a class. Used by the "clear curriculum" action.
   * @param {string} classId
   * @returns {Promise<Result>}
   */
  async removeForClass(classId) {
    const entries = this._schoolData.curriculumForClass(classId);
    for (const entry of entries) this._registry.delete(entry.id);
    await this._commit();
    return Result.ok(entries.length);
  }
}
