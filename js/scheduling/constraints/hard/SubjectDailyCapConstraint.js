/**
 * @file SubjectDailyCapConstraint.js
 * @description HARD — a class may not exceed a subject's periods-per-day cap.
 *
 * This is what stops a naive solver from putting all six Mathematics periods on
 * Monday because Monday happened to be checked first. The cap is per curriculum
 * row, so a school can allow a double Maths but only a single Music.
 */

import { IConstraint } from '../IConstraint.js';

export class SubjectDailyCapConstraint extends IConstraint {
  /** @returns {string} */
  get id() { return 'subject-daily-cap'; }

  /**
   * @param {import('../../Placement.js').Placement} placement
   * @param {import('../../ScheduleState.js').ScheduleState} state
   * @returns {boolean}
   */
  isSatisfied(placement, state) {
    const { classId, subjectId, maxPerDay } = placement.demand;

    /** @type {Map<number, number>} */
    const perDay = new Map();
    for (const slot of placement.slots) {
      perDay.set(slot.dayIndex, (perDay.get(slot.dayIndex) ?? 0) + 1);
    }

    for (const [dayIndex, adding] of perDay) {
      if (state.subjectDayCount(classId, subjectId, dayIndex) + adding > maxPerDay) return false;
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
    const { classId, subjectId, maxPerDay } = placement.demand;
    const slot = placement.slots[0];
    const subjectName = context.subject(subjectId)?.name ?? subjectId;
    const className = context.schoolClass(classId)?.name ?? classId;
    const current = state.subjectDayCount(classId, subjectId, slot.dayIndex);

    return `${className} already has ${current} period(s) of ${subjectName} on ${slot.dayLabel}, `
      + `and the daily limit for this subject is ${maxPerDay}.`;
  }
}
