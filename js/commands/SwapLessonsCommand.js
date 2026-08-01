/**
 * @file SwapLessonsCommand.js
 * @description Exchanges the contents of two occupied cells.
 *
 * Distinct from two consecutive moves: a swap is atomic. As two moves, the
 * first would be rejected because the destination is occupied, so the user
 * would have to shunt a lesson to a scratch slot and back. The administrator
 * thinks "put Maths where Music is", and the model should say the same thing.
 */

import { Command } from '../core/Command.js';
import { Result } from '../core/Result.js';

export class SwapLessonsCommand extends Command {
  /**
   * @param {object} params
   * @param {import('../domain/Timetable.js').Timetable} params.timetable
   * @param {import('../domain/Lesson.js').Lesson} params.first
   * @param {import('../domain/Lesson.js').Lesson} params.second
   * @param {string} params.label
   */
  constructor({ timetable, first, second, label }) {
    super(label);
    /** @private */ this._timetable = timetable;
    /** @private */ this._first = first;
    /** @private */ this._second = second;
  }

  /** @returns {boolean} */
  canExecute() {
    return !this._first.locked && !this._second.locked;
  }

  /** @returns {Result} */
  execute() {
    return this._exchange(this._first, this._second);
  }

  /**
   * A swap is its own inverse, so undo is literally execute again — which also
   * means undo can never disagree with execute.
   * @returns {Result}
   */
  undo() {
    return this._exchange(this._first, this._second);
  }

  /**
   * @private
   * @param {import('../domain/Lesson.js').Lesson} first
   * @param {import('../domain/Lesson.js').Lesson} second
   * @returns {Result}
   */
  _exchange(first, second) {
    const firstNow = this._timetable.getLesson(first.classId, first.slotId)
      ?? this._timetable.getLesson(first.classId, second.slotId);
    const secondNow = this._timetable.getLesson(second.classId, second.slotId)
      ?? this._timetable.getLesson(second.classId, first.slotId);

    if (!firstNow || !secondNow) {
      return Result.fail('One of those periods has changed since the swap was made.');
    }

    this._timetable.remove(firstNow.classId, firstNow.slotId);
    this._timetable.remove(secondNow.classId, secondNow.slotId);

    this._timetable.place(firstNow.withChanges({ slotId: secondNow.slotId }));
    this._timetable.place(secondNow.withChanges({ slotId: firstNow.slotId }));

    return Result.ok(2);
  }
}
