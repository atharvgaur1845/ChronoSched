/**
 * @file SchoolData.js
 * @description The aggregate root: every piece of school state in one object,
 * plus the derived queries that more than one caller needs.
 *
 * WHY THIS HOLDS `Registry`, NOT `Repository`
 * Repositories know about persistence and events, which live in the data layer.
 * If SchoolData held them, `domain/` would import from `data/` and the
 * dependency rule (`data → domain`, never the reverse) would be broken on day
 * one. So SchoolData holds plain in-memory collections, and repositories are
 * thin persistence-aware wrappers around it.
 */

import { Registry } from '../core/Registry.js';
import { Settings } from './Settings.js';
import { TimeGrid } from './TimeGrid.js';
import { Teacher } from './Teacher.js';
import { SchoolClass } from './SchoolClass.js';
import { Subject } from './Subject.js';
import { CurriculumEntry } from './CurriculumEntry.js';
import { Timetable } from './Timetable.js';
import { sortBy, sumBy } from '../utils/ArrayUtils.js';

export class SchoolData {
  constructor() {
    /** @type {Settings} */
    this.settings = new Settings();
    /** @type {TimeGrid} Derived from settings; never assigned directly. */
    this.timeGrid = TimeGrid.build(this.settings);

    /** @type {Registry<Teacher>} */
    this.teachers = new Registry();
    /** @type {Registry<SchoolClass>} */
    this.classes = new Registry();
    /** @type {Registry<Subject>} */
    this.subjects = new Registry();
    /** @type {Registry<CurriculumEntry>} */
    this.curriculum = new Registry();
    /** @type {Registry<Timetable>} */
    this.timetables = new Registry();

    /** @type {string|null} Id of the version currently being viewed/edited. */
    this.activeTimetableId = null;
  }

  /**
   * Replaces settings and rebuilds the derived grid in one step, so the two
   * can never drift apart.
   * @param {Settings} settings
   */
  applySettings(settings) {
    this.settings = settings;
    this.timeGrid = TimeGrid.build(settings);
  }

  // ------------------------------------------------------------ derived data

  /** @returns {Timetable|null} */
  get activeTimetable() {
    if (this.activeTimetableId) {
      const found = this.timetables.get(this.activeTimetableId);
      if (found) return found;
    }
    return this.latestTimetable;
  }

  /** @returns {Timetable|null} Highest version number, or null when none exist. */
  get latestTimetable() {
    let latest = null;
    for (const timetable of this.timetables) {
      if (latest === null || timetable.version > latest.version) latest = timetable;
    }
    return latest;
  }

  /** @returns {number} Version number the next generation should use. */
  get nextVersionNumber() {
    return (this.latestTimetable?.version ?? 0) + 1;
  }

  /** @returns {SchoolClass[]} Sorted for display. */
  get sortedClasses() {
    return sortBy(this.classes.toArray(), (item) => item.sortKey);
  }

  /** @returns {Teacher[]} Sorted by name. */
  get sortedTeachers() {
    return sortBy(this.teachers.toArray(), (item) => item.name.toLowerCase());
  }

  /** @returns {Subject[]} Sorted by name. */
  get sortedSubjects() {
    return sortBy(this.subjects.toArray(), (item) => item.name.toLowerCase());
  }

  /** @returns {Timetable[]} Newest version first. */
  get sortedTimetables() {
    return sortBy(this.timetables.toArray(), (item) => -item.version);
  }

  /**
   * @param {string} classId
   * @returns {CurriculumEntry[]}
   */
  curriculumForClass(classId) {
    return this.curriculum.filter((entry) => entry.classId === classId);
  }

  /**
   * @param {string} subjectId
   * @returns {CurriculumEntry[]}
   */
  curriculumForSubject(subjectId) {
    return this.curriculum.filter((entry) => entry.subjectId === subjectId);
  }

  /**
   * @param {string} teacherId
   * @returns {CurriculumEntry[]}
   */
  curriculumForTeacher(teacherId) {
    return this.curriculum.filter((entry) => entry.teacherId === teacherId);
  }

  /**
   * Teachers qualified to take a subject for a class.
   * When the entry names a teacher explicitly that teacher is the only option,
   * even if they are technically unqualified — the administrator's choice wins
   * over the eligibility lists, and ValidationService surfaces the mismatch as
   * a warning rather than silently overriding it.
   *
   * @param {CurriculumEntry} entry
   * @returns {Teacher[]}
   */
  eligibleTeachersFor(entry) {
    if (entry.teacherId) {
      const named = this.teachers.get(entry.teacherId);
      return named ? [named] : [];
    }
    return this.teachers.filter((teacher) => teacher.canTeach(entry.subjectId, entry.classId));
  }

  /**
   * Total periods per week demanded by a class's curriculum.
   * @param {string} classId
   * @returns {number}
   */
  demandForClass(classId) {
    return sumBy(this.curriculumForClass(classId), (entry) => entry.periodsPerWeek);
  }

  /**
   * Total periods per week already committed to a teacher by the curriculum.
   * @param {string} teacherId
   * @returns {number}
   */
  committedLoadForTeacher(teacherId) {
    return sumBy(this.curriculumForTeacher(teacherId), (entry) => entry.periodsPerWeek);
  }

  /**
   * Headline counts for the dashboard.
   * @returns {{teachers: number, classes: number, subjects: number, curriculum: number, timetables: number, weeklyPeriods: number}}
   */
  get counts() {
    return {
      teachers: this.teachers.size,
      classes: this.classes.size,
      subjects: this.subjects.size,
      curriculum: this.curriculum.size,
      timetables: this.timetables.size,
      weeklyPeriods: sumBy(this.curriculum.toArray(), (entry) => entry.periodsPerWeek),
    };
  }

  /** @returns {boolean} True when there is nothing to schedule yet. */
  get isEmpty() {
    return this.classes.size === 0 || this.subjects.size === 0 || this.curriculum.size === 0;
  }

  /**
   * Rehydrates every collection from plain JSON payloads.
   * Kept here rather than in DataService so the mapping from stored shape to
   * domain object lives beside the domain objects themselves.
   *
   * @param {object} payloads
   * @param {object} [payloads.settings]
   * @param {object[]} [payloads.teachers]
   * @param {object[]} [payloads.classes]
   * @param {object[]} [payloads.subjects]
   * @param {object[]} [payloads.curriculum]
   * @param {object[]} [payloads.timetables]
   * @param {string|null} [payloads.activeTimetableId]
   */
  hydrate({ settings, teachers, classes, subjects, curriculum, timetables, activeTimetableId }) {
    if (settings) this.applySettings(new Settings(settings));
    if (teachers) this.teachers.replaceAll(teachers.map((item) => new Teacher(item)));
    if (classes) this.classes.replaceAll(classes.map((item) => new SchoolClass(item)));
    if (subjects) this.subjects.replaceAll(subjects.map((item) => new Subject(item)));
    if (curriculum) this.curriculum.replaceAll(curriculum.map((item) => new CurriculumEntry(item)));
    if (timetables) this.timetables.replaceAll(timetables.map((item) => new Timetable(item)));
    if (activeTimetableId !== undefined) this.activeTimetableId = activeTimetableId;
  }

  /**
   * Full serialisation, used by JSON export and backup.
   * @returns {object}
   */
  toJSON() {
    return {
      settings: this.settings.toJSON(),
      teachers: this.teachers.map((item) => item.toJSON()),
      classes: this.classes.map((item) => item.toJSON()),
      subjects: this.subjects.map((item) => item.toJSON()),
      curriculum: this.curriculum.map((item) => item.toJSON()),
      timetables: this.timetables.map((item) => item.toJSON()),
      activeTimetableId: this.activeTimetableId,
    };
  }
}
