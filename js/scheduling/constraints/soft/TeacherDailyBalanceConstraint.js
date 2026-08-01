/**
 * @file TeacherDailyBalanceConstraint.js
 * @description SOFT — even out each teacher's load across their working days.
 *
 * TeacherDailyLoadConstraint enforces the hard ceiling. This one shapes the
 * distribution below it: a teacher committed to 18 periods over six days should
 * see roughly three a day, not six-six-six-zero-zero-zero. The target comes
 * from SchedulingContext, which divides their committed load by the days they
 * are actually available.
 */

import { ISoftConstraint } from '../IConstraint.js';

export class TeacherDailyBalanceConstraint extends ISoftConstraint {
  /** @returns {string} */
  get id() { return 'teacher-daily-balance'; }

  /** @returns {string} */
  get weightKey() { return 'teacherDailyBalance'; }

  /**
   * @param {import('../../Placement.js').Placement} placement
   * @param {import('../../ScheduleState.js').ScheduleState} state
   * @param {import('../../SchedulingContext.js').SchedulingContext} context
   * @returns {number}
   */
  penalty(placement, state, context) {
    const { teacherId } = placement;
    if (!teacherId) return 0;

    const target = context.targetPeriodsPerDay(teacherId);
    if (target <= 0) return 0;

    /** @type {Map<number, number>} */
    const additionsByDay = new Map();
    for (const slot of placement.slots) {
      additionsByDay.set(slot.dayIndex, (additionsByDay.get(slot.dayIndex) ?? 0) + 1);
    }

    let total = 0;
    for (const [dayIndex, adding] of additionsByDay) {
      const current = state.teacherDayLoad(teacherId, dayIndex);
      total += Math.max(0, current + adding - target);
    }
    return total;
  }

  /** @returns {string} */
  describe() {
    return 'Pushes a teacher above their average daily load';
  }
}
