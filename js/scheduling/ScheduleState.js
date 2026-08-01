/**
 * @file ScheduleState.js
 * @description The solver's mutable working grid, with every index it needs to
 * answer a feasibility question in constant time.
 *
 * THE PERFORMANCE DECISION OF THE WHOLE PROJECT
 * "Is teacher T free at slot S?" answered by scanning the lesson list is O(n).
 * It sits inside the solver's innermost loop, which runs
 *   demands × candidate slots × eligible teachers
 * times — for a mid-size school, tens of thousands of iterations, each doing an
 * O(n) scan over a growing list. That is the difference between a generator
 * that finishes in milliseconds and one that freezes the browser tab.
 *
 * So the same lessons are stored six ways. Every index is updated in place() /
 * unplace(), which are the ONLY two mutating methods — that invariant is what
 * keeps six redundant structures from drifting apart.
 */

import { Lesson } from '../domain/Lesson.js';

/** @private Composite key helpers. Inlined string templates for speed. */
const cellKey = (classId, slotId) => `${classId}|${slotId}`;
const teacherSlotKey = (teacherId, slotId) => `${teacherId}|${slotId}`;
const teacherDayKey = (teacherId, dayIndex) => `${teacherId}|${dayIndex}`;
const subjectDayKey = (classId, subjectId, dayIndex) => `${classId}|${subjectId}|${dayIndex}`;
const classDayKey = (classId, dayIndex) => `${classId}|${dayIndex}`;

export class ScheduleState {
  /**
   * @param {import('../domain/TimeGrid.js').TimeGrid} timeGrid
   */
  constructor(timeGrid) {
    /** @private */ this._grid = timeGrid;

    /** @private @type {Lesson[]} */
    this._lessons = [];

    /** @private @type {Map<string, Lesson>} classId|slotId → lesson */
    this._byCell = new Map();
    /** @private @type {Map<string, Lesson>} teacherId|slotId → lesson */
    this._byTeacherSlot = new Map();
    /** @private @type {Map<string, number>} teacherId|dayIndex → count */
    this._teacherDayLoad = new Map();
    /** @private @type {Map<string, number>} teacherId → count */
    this._teacherWeekLoad = new Map();
    /** @private @type {Map<string, number>} classId|subjectId|dayIndex → count */
    this._subjectDayLoad = new Map();
    /** @private @type {Map<string, number>} classId|dayIndex → difficulty sum */
    this._classDayDifficulty = new Map();
    /** @private @type {Map<string, Set<number>>} teacherId|dayIndex → period indexes */
    this._teacherDayPeriods = new Map();
  }

  /** @returns {number} */
  get placedCount() {
    return this._lessons.length;
  }

  /** @returns {Lesson[]} Defensive copy. */
  get lessons() {
    return [...this._lessons];
  }

  /**
   * Commits a placement: one lesson per slot in the placement's window.
   * @param {import('./Placement.js').Placement} placement
   */
  place(placement) {
    const { demand, slots, teacherId } = placement;
    for (const slot of slots) {
      this._add(new Lesson({
        slotId: slot.id,
        classId: demand.classId,
        subjectId: demand.subjectId,
        teacherId,
        locked: false,
        blockId: demand.blockId,
      }), slot, demand.difficulty);
    }
  }

  /**
   * Reverses a placement. Exact inverse of {@link place} — backtracking depends
   * on that being true.
   * @param {import('./Placement.js').Placement} placement
   */
  unplace(placement) {
    const { demand, slots } = placement;
    for (const slot of slots) {
      const lesson = this._byCell.get(cellKey(demand.classId, slot.id));
      if (lesson) this._remove(lesson, slot, demand.difficulty);
    }
  }

  /**
   * Inserts a pre-existing lesson (a locked manual edit) before solving begins.
   * @param {Lesson} lesson
   * @param {number} difficulty
   */
  seedLesson(lesson, difficulty) {
    const slot = this._grid.getSlot(lesson.slotId);
    if (!slot) return;
    this._add(lesson, slot, difficulty);
  }

  /**
   * @private
   * @param {Lesson} lesson
   * @param {import('../domain/TimeSlot.js').TimeSlot} slot
   * @param {number} difficulty
   */
  _add(lesson, slot, difficulty) {
    this._lessons.push(lesson);
    this._byCell.set(cellKey(lesson.classId, lesson.slotId), lesson);

    if (lesson.teacherId) {
      this._byTeacherSlot.set(teacherSlotKey(lesson.teacherId, lesson.slotId), lesson);
      this._bump(this._teacherDayLoad, teacherDayKey(lesson.teacherId, slot.dayIndex), 1);
      this._bump(this._teacherWeekLoad, lesson.teacherId, 1);

      const periodsKey = teacherDayKey(lesson.teacherId, slot.dayIndex);
      let periods = this._teacherDayPeriods.get(periodsKey);
      if (!periods) {
        periods = new Set();
        this._teacherDayPeriods.set(periodsKey, periods);
      }
      periods.add(slot.periodIndex);
    }

    this._bump(this._subjectDayLoad, subjectDayKey(lesson.classId, lesson.subjectId, slot.dayIndex), 1);
    this._bump(this._classDayDifficulty, classDayKey(lesson.classId, slot.dayIndex), difficulty);
  }

  /**
   * @private
   * @param {Lesson} lesson
   * @param {import('../domain/TimeSlot.js').TimeSlot} slot
   * @param {number} difficulty
   */
  _remove(lesson, slot, difficulty) {
    const index = this._lessons.indexOf(lesson);
    if (index >= 0) this._lessons.splice(index, 1);
    this._byCell.delete(cellKey(lesson.classId, lesson.slotId));

    if (lesson.teacherId) {
      this._byTeacherSlot.delete(teacherSlotKey(lesson.teacherId, lesson.slotId));
      this._bump(this._teacherDayLoad, teacherDayKey(lesson.teacherId, slot.dayIndex), -1);
      this._bump(this._teacherWeekLoad, lesson.teacherId, -1);
      this._teacherDayPeriods.get(teacherDayKey(lesson.teacherId, slot.dayIndex))?.delete(slot.periodIndex);
    }

    this._bump(this._subjectDayLoad, subjectDayKey(lesson.classId, lesson.subjectId, slot.dayIndex), -1);
    this._bump(this._classDayDifficulty, classDayKey(lesson.classId, slot.dayIndex), -difficulty);
  }

  /**
   * @private
   * @param {Map<string, number>} map
   * @param {string} key
   * @param {number} delta
   */
  _bump(map, key, delta) {
    const next = (map.get(key) ?? 0) + delta;
    if (next === 0) map.delete(key);
    else map.set(key, next);
  }

  // ------------------------------------------------------------ O(1) queries

  /**
   * @param {string} classId
   * @param {string} slotId
   * @returns {boolean}
   */
  isClassFree(classId, slotId) {
    return !this._byCell.has(cellKey(classId, slotId));
  }

  /**
   * @param {string} teacherId
   * @param {string} slotId
   * @returns {boolean}
   */
  isTeacherFree(teacherId, slotId) {
    return !this._byTeacherSlot.has(teacherSlotKey(teacherId, slotId));
  }

  /**
   * @param {string} classId
   * @param {string} slotId
   * @returns {Lesson|undefined}
   */
  lessonAt(classId, slotId) {
    return this._byCell.get(cellKey(classId, slotId));
  }

  /**
   * @param {string} teacherId
   * @param {number} dayIndex
   * @returns {number}
   */
  teacherDayLoad(teacherId, dayIndex) {
    return this._teacherDayLoad.get(teacherDayKey(teacherId, dayIndex)) ?? 0;
  }

  /**
   * @param {string} teacherId
   * @returns {number}
   */
  teacherWeekLoad(teacherId) {
    return this._teacherWeekLoad.get(teacherId) ?? 0;
  }

  /**
   * @param {string} classId
   * @param {string} subjectId
   * @param {number} dayIndex
   * @returns {number}
   */
  subjectDayCount(classId, subjectId, dayIndex) {
    return this._subjectDayLoad.get(subjectDayKey(classId, subjectId, dayIndex)) ?? 0;
  }

  /**
   * @param {string} classId
   * @param {number} dayIndex
   * @returns {number} Sum of subject difficulties scheduled that day.
   */
  classDayDifficulty(classId, dayIndex) {
    return this._classDayDifficulty.get(classDayKey(classId, dayIndex)) ?? 0;
  }

  /**
   * Period indexes a teacher is busy on one day. Used to measure gaps.
   * @param {string} teacherId
   * @param {number} dayIndex
   * @returns {Set<number>}
   */
  teacherDayPeriods(teacherId, dayIndex) {
    return this._teacherDayPeriods.get(teacherDayKey(teacherId, dayIndex)) ?? new Set();
  }

  /**
   * Free periods sandwiched between two taught periods, for one teacher-day.
   * @param {string} teacherId
   * @param {number} dayIndex
   * @returns {number}
   */
  teacherGapCount(teacherId, dayIndex) {
    const periods = this.teacherDayPeriods(teacherId, dayIndex);
    if (periods.size < 2) return 0;

    let min = Infinity;
    let max = -Infinity;
    for (const period of periods) {
      if (period < min) min = period;
      if (period > max) max = period;
    }
    return (max - min + 1) - periods.size;
  }
}
