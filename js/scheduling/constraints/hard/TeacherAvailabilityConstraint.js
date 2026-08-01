/**
 * @file TeacherAvailabilityConstraint.js
 * @description HARD — a teacher's declared unavailable periods are absolute.
 *
 * Note the deliberate contrast with PreferredFreePeriodConstraint, which is
 * soft. "Unavailable" means the person is not in the building; "preferred free"
 * means they would rather not teach then. Treating the second as hard is what
 * turns a solvable school into "no solution found".
 */

import { IConstraint } from '../IConstraint.js';

export class TeacherAvailabilityConstraint extends IConstraint {
  /** @returns {string} */
  get id() { return 'teacher-availability'; }

  /**
   * @param {import('../../Placement.js').Placement} placement
   * @param {import('../../ScheduleState.js').ScheduleState} _state
   * @param {import('../../SchedulingContext.js').SchedulingContext} context
   * @returns {boolean}
   */
  isSatisfied(placement, _state, context) {
    const { teacherId } = placement;
    if (!teacherId) return true;

    const teacher = context.teacher(teacherId);
    if (!teacher) return true;

    for (const slot of placement.slots) {
      if (!teacher.isAvailableAt(slot.dayIndex, slot.periodIndex)) return false;
    }
    return true;
  }

  /**
   * @param {import('../../Placement.js').Placement} placement
   * @param {import('../../ScheduleState.js').ScheduleState} _state
   * @param {import('../../SchedulingContext.js').SchedulingContext} context
   * @returns {string}
   */
  explain(placement, _state, context) {
    const teacher = context.teacher(placement.teacherId ?? '');
    const name = teacher?.name ?? 'That teacher';

    for (const slot of placement.slots) {
      if (teacher && !teacher.isAvailableAt(slot.dayIndex, slot.periodIndex)) {
        return `${name} is marked unavailable on ${slot.dayLabel} period ${slot.periodNumber}.`;
      }
    }
    return `${name} is unavailable in one of those periods.`;
  }
}
