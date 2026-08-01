/**
 * @file ClassClashConstraint.js
 * @description HARD — a class cannot study two subjects at the same time.
 *
 * Registered first because it is the cheapest check (one Map lookup per slot)
 * and rejects the largest share of candidates, short-circuiting everything
 * behind it.
 */

import { IConstraint } from '../IConstraint.js';

export class ClassClashConstraint extends IConstraint {
  /** @returns {string} */
  get id() { return 'class-clash'; }

  /**
   * @param {import('../../Placement.js').Placement} placement
   * @param {import('../../ScheduleState.js').ScheduleState} state
   * @returns {boolean}
   */
  isSatisfied(placement, state) {
    const { classId } = placement.demand;
    for (const slot of placement.slots) {
      if (!state.isClassFree(classId, slot.id)) return false;
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
    const { classId } = placement.demand;
    const className = context.schoolClass(classId)?.name ?? classId;

    for (const slot of placement.slots) {
      const existing = state.lessonAt(classId, slot.id);
      if (existing) {
        const subject = context.subject(existing.subjectId)?.name ?? existing.subjectId;
        return `${className} already has ${subject} on ${slot.dayLabel} period ${slot.periodNumber}.`;
      }
    }
    return `${className} is already busy in one of those periods.`;
  }
}
