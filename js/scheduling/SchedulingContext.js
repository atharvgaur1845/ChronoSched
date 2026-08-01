/**
 * @file SchedulingContext.js
 * @description Read-only inputs and precomputed lookups shared by every
 * strategy and every constraint for the duration of one solve.
 *
 * WHY PRECOMPUTE
 * Constraints are called on the order of 10^5 times per generation. Anything
 * derived — the eligible-teacher pool for a demand, the consecutive-slot
 * windows of a given size, a class's target difficulty per day — must be
 * computed once here rather than rebuilt inside the loop. The context is
 * immutable for the whole solve, so caching is always safe.
 */

import { RecessSide } from '../utils/Constants.js';

export class SchedulingContext {
  /**
   * @param {object} deps
   * @param {import('../domain/SchoolData.js').SchoolData} deps.schoolData
   * @param {import('../domain/TimeGrid.js').TimeGrid} deps.timeGrid
   * @param {import('../domain/Settings.js').Settings} deps.settings
   */
  constructor({ schoolData, timeGrid, settings }) {
    /** @type {import('../domain/SchoolData.js').SchoolData} */
    this.schoolData = schoolData;
    /** @type {import('../domain/TimeGrid.js').TimeGrid} */
    this.timeGrid = timeGrid;
    /** @type {import('../domain/Settings.js').Settings} */
    this.settings = settings;
    /** @type {Record<string, number>} */
    this.weights = settings.constraintWeights;
    /** @type {{from: number, to: number}} */
    this.corePeriodWindow = settings.corePeriodWindow;
    /** @type {boolean} True when a recess exists to be "before" or "after". */
    this.hasRecess = settings.recess !== null;

    /** @private @type {Map<number, import('../domain/TimeSlot.js').TimeSlot[][]>} */
    this._windowCache = new Map();
    /** @private @type {Map<string, import('../domain/Teacher.js').Teacher[]>} */
    this._teacherPoolCache = new Map();
    /** @private @type {Map<string, number>} */
    this._classPressure = new Map();
    /** @private @type {Map<string, number>} */
    this._targetDailyDifficulty = new Map();
    /** @private @type {Map<string, number>} */
    this._teacherTargetPerDay = new Map();

    this._precompute();
  }

  /**
   * Builds the per-class and per-teacher targets the soft constraints compare
   * against. All O(curriculum), done once.
   * @private
   */
  _precompute() {
    const dayCount = Math.max(1, this.timeGrid.dayCount);
    const capacity = Math.max(1, this.timeGrid.slotCount);

    for (const schoolClass of this.schoolData.classes) {
      const rows = this.schoolData.curriculumForClass(schoolClass.id);
      const periods = rows.reduce((total, row) => total + row.periodsPerWeek, 0);
      const difficulty = rows.reduce((total, row) => {
        const subject = this.schoolData.subjects.get(row.subjectId);
        return total + (subject?.difficulty ?? 3) * row.periodsPerWeek;
      }, 0);

      this._classPressure.set(schoolClass.id, Math.min(1, periods / capacity));
      this._targetDailyDifficulty.set(schoolClass.id, difficulty / dayCount);
    }

    for (const teacher of this.schoolData.teachers) {
      const committed = this.schoolData.committedLoadForTeacher(teacher.id);
      const availableDays = Math.max(1, dayCount - teacher.unavailableSlots
        .filter((slot) => slot.periodIndex === null).length);
      this._teacherTargetPerDay.set(
        teacher.id,
        Math.min(teacher.maxPeriodsPerDay, Math.ceil(committed / availableDays)),
      );
    }
  }

  /**
   * Every run of `size` consecutive slots in the week, cached per size.
   * @param {number} size
   * @returns {import('../domain/TimeSlot.js').TimeSlot[][]}
   */
  windowsOfSize(size) {
    let windows = this._windowCache.get(size);
    if (!windows) {
      windows = this.timeGrid.consecutiveWindows(size);
      this._windowCache.set(size, windows);
    }
    return windows;
  }

  /**
   * Teachers who may take a demand. A pinned teacher is the only candidate.
   * @param {import('./LessonDemand.js').LessonDemand} demand
   * @returns {import('../domain/Teacher.js').Teacher[]}
   */
  eligibleTeachersFor(demand) {
    const key = demand.fixedTeacherId ?? `${demand.subjectId}|${demand.classId}`;
    let pool = this._teacherPoolCache.get(key);
    if (pool) return pool;

    if (demand.fixedTeacherId) {
      const named = this.schoolData.teachers.get(demand.fixedTeacherId);
      pool = named ? [named] : [];
    } else {
      pool = this.schoolData.teachers.filter(
        (teacher) => teacher.canTeach(demand.subjectId, demand.classId),
      );
    }

    this._teacherPoolCache.set(key, pool);
    return pool;
  }

  /**
   * How full a class's week already is, 0–1. Feeds the demand ordering.
   * @param {string} classId
   * @returns {number}
   */
  classPressure(classId) {
    return this._classPressure.get(classId) ?? 0;
  }

  /**
   * Difficulty points a class should ideally carry on an average day.
   * @param {string} classId
   * @returns {number}
   */
  targetDailyDifficulty(classId) {
    return this._targetDailyDifficulty.get(classId) ?? 0;
  }

  /**
   * Periods a teacher should ideally carry on an average working day.
   * @param {string} teacherId
   * @returns {number}
   */
  targetPeriodsPerDay(teacherId) {
    return this._teacherTargetPerDay.get(teacherId) ?? 0;
  }

  /**
   * @param {string} teacherId
   * @returns {import('../domain/Teacher.js').Teacher|undefined}
   */
  teacher(teacherId) {
    return this.schoolData.teachers.get(teacherId);
  }

  /**
   * @param {string} subjectId
   * @returns {import('../domain/Subject.js').Subject|undefined}
   */
  subject(subjectId) {
    return this.schoolData.subjects.get(subjectId);
  }

  /**
   * @param {string} classId
   * @returns {import('../domain/SchoolClass.js').SchoolClass|undefined}
   */
  schoolClass(classId) {
    return this.schoolData.classes.get(classId);
  }

  /**
   * Display name for a demand, used in reports the administrator reads.
   * @param {import('./LessonDemand.js').LessonDemand} demand
   * @returns {string}
   */
  describeDemand(demand) {
    const subject = this.subject(demand.subjectId)?.name ?? demand.subjectId;
    const className = this.schoolClass(demand.classId)?.name ?? demand.classId;
    const span = demand.size > 1 ? ` (${demand.size} consecutive periods)` : '';
    return `${subject} for ${className}${span}`;
  }

  /**
   * Weight for a soft constraint, defaulting to 1 when unconfigured so a newly
   * added constraint still has an effect before anyone tunes it.
   * @param {string} weightKey
   * @returns {number}
   */
  weightFor(weightKey) {
    return this.weights[weightKey] ?? 1;
  }

  /** @returns {boolean} Whether recess-side preferences can be honoured at all. */
  get recessPreferencesActive() {
    return this.hasRecess;
  }

  /** @returns {string} */
  static get ANY_RECESS() {
    return RecessSide.ANY;
  }
}
