/**
 * @file SubjectSpreadConstraint.js
 * @description SOFT — prefer a subject's periods on different days.
 *
 * SubjectDailyCapConstraint already forbids exceeding the cap. This adds a
 * gentle push below the cap: with a cap of 2, a second Mathematics period on
 * the same day is legal but costs something, so the solver only doubles up when
 * the alternative is worse. Without it, a subject allowed 2/day tends to land
 * as three clean doubles rather than being spread across the week.
 */

import { ISoftConstraint } from '../IConstraint.js';

export class SubjectSpreadConstraint extends ISoftConstraint {
  /** @returns {string} */
  get id() { return 'subject-spread'; }

  /** @returns {string} */
  get weightKey() { return 'subjectSpread'; }

  /**
   * @param {import('../../Placement.js').Placement} placement
   * @param {import('../../ScheduleState.js').ScheduleState} state
   * @returns {number}
   */
  penalty(placement, state) {
    const { classId, subjectId } = placement.demand;

    /** @type {Set<number>} */
    const days = new Set();
    for (const slot of placement.slots) days.add(slot.dayIndex);

    let total = 0;
    for (const dayIndex of days) {
      // A consecutive block occupies one day by design, so its own periods are
      // not charged against each other — only pre-existing periods count.
      total += state.subjectDayCount(classId, subjectId, dayIndex);
    }
    return total;
  }

  /** @returns {string} */
  describe() {
    return 'Repeats a subject on a day it already appears';
  }
}
