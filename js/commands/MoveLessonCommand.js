/**
 * @file MoveLessonCommand.js
 * @description Moves a lesson — or a whole consecutive block — to new periods.
 *
 * Handles both cases through one code path by always working with a LIST of
 * (lesson, targetSlot) pairs. A single period is simply a list of one. The
 * alternative, two near-identical commands, would drift apart the first time
 * someone fixed a bug in only one of them.
 */

import { Command } from '../core/Command.js';
import { Result } from '../core/Result.js';
import { Lesson } from '../domain/Lesson.js';

export class MoveLessonCommand extends Command {
  /**
   * @param {object} params
   * @param {import('../domain/Timetable.js').Timetable} params.timetable
   * @param {Array<{lesson: Lesson, targetSlotId: string}>} params.moves
   * @param {string} params.label
   */
  constructor({ timetable, moves, label }) {
    super(label);
    /** @private */ this._timetable = timetable;
    /** @private */ this._moves = moves;
    /** @private @type {Lesson[]} Anything displaced, so undo can restore it. */
    this._displaced = [];
  }

  /** @returns {boolean} */
  canExecute() {
    return this._moves.length > 0 && this._moves.every(({ lesson }) => !lesson.locked);
  }

  /**
   * @returns {Result}
   */
  execute() {
    this._displaced = [];

    // Every source cell is emptied before any target is filled. Doing it
    // interleaved would make a block sliding by one period overwrite its own
    // second half.
    for (const { lesson } of this._moves) {
      this._timetable.remove(lesson.classId, lesson.slotId);
    }

    for (const { lesson, targetSlotId } of this._moves) {
      const occupant = this._timetable.getLesson(lesson.classId, targetSlotId);
      if (occupant) {
        this._displaced.push(occupant);
        this._timetable.remove(occupant.classId, occupant.slotId);
      }
      this._timetable.place(lesson.withChanges({ slotId: targetSlotId }));
    }

    return Result.ok(this._moves.length);
  }

  /**
   * @returns {Result}
   */
  undo() {
    for (const { lesson, targetSlotId } of this._moves) {
      this._timetable.remove(lesson.classId, targetSlotId);
    }
    for (const { lesson } of this._moves) {
      this._timetable.place(lesson);
    }
    for (const occupant of this._displaced) {
      this._timetable.place(occupant);
    }
    this._displaced = [];
    return Result.ok(this._moves.length);
  }

  /**
   * Collapses repeated nudges of the same lesson into one history entry.
   * @param {Command} previous
   * @returns {Command|null}
   */
  mergeWith(previous) {
    if (!(previous instanceof MoveLessonCommand)) return null;
    if (previous._moves.length !== 1 || this._moves.length !== 1) return null;

    const earlier = previous._moves[0];
    const later = this._moves[0];
    const isContinuation = earlier.targetSlotId === later.lesson.slotId
      && earlier.lesson.classId === later.lesson.classId
      && earlier.lesson.subjectId === later.lesson.subjectId;

    if (!isContinuation) return null;

    const merged = new MoveLessonCommand({
      timetable: this._timetable,
      moves: [{ lesson: earlier.lesson, targetSlotId: later.targetSlotId }],
      label: this.label,
    });
    merged._displaced = [...previous._displaced, ...this._displaced];
    merged.setExecuted(true);
    return merged;
  }
}
