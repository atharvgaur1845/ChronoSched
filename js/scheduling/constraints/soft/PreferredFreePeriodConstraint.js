/**
 * @file PreferredFreePeriodConstraint.js
 * @description SOFT — respect the periods a teacher asked to keep free.
 *
 * The soft counterpart to TeacherAvailabilityConstraint. Same data shape, very
 * different force: "unavailable" is a fact about where the person is,
 * "preferred free" is a request. Modelling requests as facts is how a timetable
 * generator ends up reporting no solution for a school that has one.
 */

import { ISoftConstraint } from '../IConstraint.js';

export class PreferredFreePeriodConstraint extends ISoftConstraint {
  /** @returns {string} */
  get id() { return 'preferred-free-period'; }

  /** @returns {string} */
  get weightKey() { return 'preferredFreePeriod'; }

  /**
   * @param {import('../../Placement.js').Placement} placement
   * @param {import('../../ScheduleState.js').ScheduleState} _state
   * @param {import('../../SchedulingContext.js').SchedulingContext} context
   * @returns {number}
   */
  penalty(placement, _state, context) {
    const { teacherId } = placement;
    if (!teacherId) return 0;

    const teacher = context.teacher(teacherId);
    if (!teacher || teacher.preferredFreeSlots.length === 0) return 0;

    let total = 0;
    for (const slot of placement.slots) {
      if (teacher.prefersFreeAt(slot.dayIndex, slot.periodIndex)) total += 1;
    }
    return total;
  }

  /** @returns {string} */
  describe() {
    return 'Uses a period the teacher asked to keep free';
  }
}
