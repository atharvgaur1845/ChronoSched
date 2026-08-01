/**
 * @file AssignTeacherCommand.js
 * @description Changes (or clears) the teacher on one lesson, or on every
 * period of a consecutive block.
 *
 * Block members are updated together because a lab taught by two different
 * people across its two halves is not a thing any school wants, and letting the
 * UI produce it would mean the constraint system had to defend against it.
 */

import { Command } from '../core/Command.js';
import { Result } from '../core/Result.js';

export class AssignTeacherCommand extends Command {
  /**
   * @param {object} params
   * @param {import('../domain/Timetable.js').Timetable} params.timetable
   * @param {import('../domain/Lesson.js').Lesson[]} params.lessons Cells to update.
   * @param {string|null} params.teacherId
   * @param {string} params.label
   */
  constructor({ timetable, lessons, teacherId, label }) {
    super(label);
    /** @private */ this._timetable = timetable;
    /** @private */ this._lessons = lessons;
    /** @private */ this._teacherId = teacherId;
    /** @private @type {Array<{classId: string, slotId: string, teacherId: string|null}>} */
    this._previous = [];
  }

  /** @returns {Result} */
  execute() {
    this._previous = this._lessons.map((lesson) => ({
      classId: lesson.classId,
      slotId: lesson.slotId,
      teacherId: lesson.teacherId,
    }));

    for (const lesson of this._lessons) {
      const current = this._timetable.getLesson(lesson.classId, lesson.slotId);
      if (!current) continue;
      this._timetable.place(current.withChanges({ teacherId: this._teacherId }));
    }
    return Result.ok(this._lessons.length);
  }

  /** @returns {Result} */
  undo() {
    for (const snapshot of this._previous) {
      const current = this._timetable.getLesson(snapshot.classId, snapshot.slotId);
      if (!current) continue;
      this._timetable.place(current.withChanges({ teacherId: snapshot.teacherId }));
    }
    return Result.ok(this._previous.length);
  }
}
