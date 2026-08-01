/**
 * @file TeacherWeeklyLoadConstraint.js
 * @description HARD — a teacher's maximum periods per week.
 *
 * Matters most when a subject leaves its teacher unpinned: without this the
 * solver would happily hand every unassigned period to whichever teacher it
 * checks first, producing one person on 40 periods and another on four.
 */

import { IConstraint } from '../IConstraint.js';

export class TeacherWeeklyLoadConstraint extends IConstraint {
  /** @returns {string} */
  get id() { return 'teacher-weekly-load'; }

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

    return state.teacherWeekLoad(teacherId) + placement.slots.length <= teacher.maxPeriodsPerWeek;
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
    const current = state.teacherWeekLoad(placement.teacherId ?? '');

    return `${name} is already scheduled for ${current} periods this week `
      + `and their weekly limit is ${teacher?.maxPeriodsPerWeek ?? 0}.`;
  }
}
