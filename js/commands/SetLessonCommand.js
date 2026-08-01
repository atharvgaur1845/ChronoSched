/**
 * @file SetLessonCommand.js
 * @description Puts a subject into a cell, or replaces what is already there,
 * and toggles the pin (lock) flag.
 *
 * Two closely-related operations share this file because both are "overwrite
 * one cell with a new Lesson value and remember the old one". Splitting them
 * would duplicate the same eight lines of undo logic.
 */

import { Command } from '../core/Command.js';
import { Result } from '../core/Result.js';
import { Lesson } from '../domain/Lesson.js';

/**
 * Creates or replaces the lesson in a single cell.
 */
export class SetLessonCommand extends Command {
  /**
   * @param {object} params
   * @param {import('../domain/Timetable.js').Timetable} params.timetable
   * @param {string} params.classId
   * @param {string} params.slotId
   * @param {string} params.subjectId
   * @param {string|null} params.teacherId
   * @param {string} params.label
   */
  constructor({ timetable, classId, slotId, subjectId, teacherId, label }) {
    super(label);
    /** @private */ this._timetable = timetable;
    /** @private */ this._classId = classId;
    /** @private */ this._slotId = slotId;
    /** @private */ this._subjectId = subjectId;
    /** @private */ this._teacherId = teacherId ?? null;
    /** @private @type {Lesson|null} */ this._previous = null;
  }

  /** @returns {Result} */
  execute() {
    this._previous = this._timetable.getLesson(this._classId, this._slotId) ?? null;

    this._timetable.place(new Lesson({
      slotId: this._slotId,
      classId: this._classId,
      subjectId: this._subjectId,
      teacherId: this._teacherId,
      locked: false,
      blockId: null,
    }));
    return Result.ok(1);
  }

  /** @returns {Result} */
  undo() {
    this._timetable.remove(this._classId, this._slotId);
    if (this._previous) this._timetable.place(this._previous);
    this._previous = null;
    return Result.ok(1);
  }
}

/**
 * Pins or unpins periods so a regeneration schedules around them.
 */
export class ToggleLockCommand extends Command {
  /**
   * @param {object} params
   * @param {import('../domain/Timetable.js').Timetable} params.timetable
   * @param {Lesson[]} params.lessons
   * @param {boolean} params.locked Target state; applied to all of them.
   * @param {string} params.label
   */
  constructor({ timetable, lessons, locked, label }) {
    super(label);
    /** @private */ this._timetable = timetable;
    /** @private */ this._lessons = lessons;
    /** @private */ this._locked = locked;
    /** @private @type {Array<{classId: string, slotId: string, locked: boolean}>} */
    this._previous = [];
  }

  /** @returns {Result} */
  execute() {
    this._previous = this._lessons.map((lesson) => ({
      classId: lesson.classId,
      slotId: lesson.slotId,
      locked: lesson.locked,
    }));
    this._applyAll(() => this._locked);
    return Result.ok(this._lessons.length);
  }

  /** @returns {Result} */
  undo() {
    const byCell = new Map(this._previous.map((item) => [`${item.classId}|${item.slotId}`, item.locked]));
    this._applyAll((lesson) => byCell.get(`${lesson.classId}|${lesson.slotId}`) ?? false);
    return Result.ok(this._previous.length);
  }

  /**
   * @private
   * @param {(lesson: Lesson) => boolean} resolve
   */
  _applyAll(resolve) {
    for (const lesson of this._lessons) {
      const current = this._timetable.getLesson(lesson.classId, lesson.slotId);
      if (!current) continue;
      this._timetable.place(current.withChanges({ locked: resolve(current) }));
    }
  }
}
