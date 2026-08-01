/**
 * @file TeacherDailyLoadConstraint.js
 * @description HARD — a teacher's maximum periods per day.
 *
 * The check adds the whole placement at once (`+ placement.slots.length`)
 * rather than one period at a time, because a 2-period lab block must be
 * rejected outright if only one period of headroom remains. Checking
 * per-period would let the first half through and strand the second.
 */

import { IConstraint } from '../IConstraint.js';

export class TeacherDailyLoadConstraint extends IConstraint {
  /** @returns {string} */
  get id() { return 'teacher-daily-load'; }

  /**
   * @param {import('../../Placement.js').Placement} placement
   * @param {import('../../ScheduleState.js').ScheduleState} state
   * @param {import('../../SchedulingContext.js').SchedulingContext} context
   * @returns {boolean}
   */
  isSatisfied(placement, state, context) {
    const { teacherId } = placement;
    if (!teacherId) return true;

    const teacher = context.teacher(teacherId);
    if (!teacher) return true;

    // A block always sits inside one day, but a caller could construct a
    // placement spanning days, so count per day rather than assuming.
    /** @type {Map<number, number>} */
    const perDay = new Map();
    for (const slot of placement.slots) {
      perDay.set(slot.dayIndex, (perDay.get(slot.dayIndex) ?? 0) + 1);
    }

    for (const [dayIndex, adding] of perDay) {
      if (state.teacherDayLoad(teacherId, dayIndex) + adding > teacher.maxPeriodsPerDay) return false;
    }
    return true;
  }

  /**
   * @param {import('../../Placement.js').Placement} placement
   * @param {import('../../ScheduleState.js').ScheduleState} state
   * @param {import('../../SchedulingContext.js').SchedulingContext} context
   * @returns {string}
   */
  explain(placement, state, context) {
    const teacher = context.teacher(placement.teacherId ?? '');
    const name = teacher?.name ?? 'That teacher';
    const slot = placement.slots[0];
    const current = state.teacherDayLoad(placement.teacherId ?? '', slot.dayIndex);

    return `${name} already has ${current} period(s) on ${slot.dayLabel} `
      + `and their daily limit is ${teacher?.maxPeriodsPerDay ?? 0}.`;
  }
}
