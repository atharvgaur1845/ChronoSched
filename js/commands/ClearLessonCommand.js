/**
 * @file ClearLessonCommand.js
 * @description Empties one cell, or every period of a consecutive block.
 *
 * The removed lessons are kept verbatim on the command, so undo restores the
 * exact objects — including their teacher, lock state and block membership —
 * rather than a reconstruction that might differ in some field nobody thought
 * to copy.
 */

import { Command } from '../core/Command.js';
import { Result } from '../core/Result.js';

export class ClearLessonCommand extends Command {
  /**
   * @param {object} params
   * @param {import('../domain/Timetable.js').Timetable} params.timetable
   * @param {import('../domain/Lesson.js').Lesson[]} params.lessons
   * @param {string} params.label
   */
  constructor({ timetable, lessons, label }) {
    super(label);
    /** @private */ this._timetable = timetable;
    /** @private */ this._lessons = lessons;
    /** @private @type {import('../domain/Lesson.js').Lesson[]} */
    this._removed = [];
  }

  /** @returns {boolean} */
  canExecute() {
    return this._lessons.length > 0;
  }

  /** @returns {Result} */
  execute() {
    this._removed = [];
    for (const lesson of this._lessons) {
      const removed = this._timetable.remove(lesson.classId, lesson.slotId);
      if (removed) this._removed.push(removed);
    }
    return this._removed.length > 0
      ? Result.ok(this._removed.length)
      : Result.fail('Those periods are already empty.');
  }

  /** @returns {Result} */
  undo() {
    for (const lesson of this._removed) this._timetable.place(lesson);
    const count = this._removed.length;
    this._removed = [];
    return Result.ok(count);
  }
}
