/**
 * @file TeacherGapConstraint.js
 * @description SOFT — avoid stranding a teacher with idle periods between classes.
 *
 * A teacher timetabled for periods 1, 2 and 8 has five wasted periods in the
 * middle of their day. The measure used is span minus count: the number of free
 * periods lying *between* their first and last class. Periods before the first
 * or after the last class are not gaps — those are simply a short day, which is
 * a benefit rather than a cost.
 *
 * The penalty is the CHANGE in gap count caused by this placement, not the
 * absolute gap count. Charging the absolute value would penalise a teacher's
 * later placements for a gap that an earlier placement created, double-counting
 * the same problem and skewing every subsequent comparison.
 */

import { ISoftConstraint } from '../IConstraint.js';

export class TeacherGapConstraint extends ISoftConstraint {
  /** @returns {string} */
  get id() { return 'teacher-gap'; }

  /** @returns {string} */
  get weightKey() { return 'teacherGap'; }

  /**
   * @param {import('../../Placement.js').Placement} placement
   * @param {import('../../ScheduleState.js').ScheduleState} state
   * @returns {number}
   */
  penalty(placement, state) {
    const { teacherId } = placement;
    if (!teacherId) return 0;

    /** @type {Map<number, number[]>} dayIndex → period indexes being added */
    const additionsByDay = new Map();
    for (const slot of placement.slots) {
      const list = additionsByDay.get(slot.dayIndex);
      if (list) list.push(slot.periodIndex);
      else additionsByDay.set(slot.dayIndex, [slot.periodIndex]);
    }

    let delta = 0;
    for (const [dayIndex, addedPeriods] of additionsByDay) {
      const before = state.teacherGapCount(teacherId, dayIndex);

      // Simulate without mutating state — the solver calls this on candidates
      // that will mostly be discarded, so touching the real indexes would be
      // both slow and error-prone.
      const combined = new Set(state.teacherDayPeriods(teacherId, dayIndex));
      for (const period of addedPeriods) combined.add(period);

      delta += TeacherGapConstraint._gapsIn(combined) - before;
    }
    return Math.max(0, delta);
  }

  /**
   * @private
   * @param {Set<number>} periods
   * @returns {number}
   */
  static _gapsIn(periods) {
    if (periods.size < 2) return 0;
    let min = Infinity;
    let max = -Infinity;
    for (const period of periods) {
      if (period < min) min = period;
      if (period > max) max = period;
    }
    return (max - min + 1) - periods.size;
  }

  /** @returns {string} */
  describe() {
    return 'Creates an idle period in the teacher\'s day';
  }
}
