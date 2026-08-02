/**
 * @file WeeklyDistributionConstraint.js
 * @description SOFT — controls HOW OFTEN across the week, as distinct from how
 * many times in total.
 *
 * THE PROBLEM THIS SOLVES
 * `periodsPerWeek` says a class gets two periods of Art. It says nothing about
 * *when*, so the solver is equally happy putting them on Monday and Tuesday as
 * on Monday and Thursday. Only the second is what a school means by "twice a
 * week". The same gap in the other direction lets a seven-period core subject
 * bunch into Monday–Wednesday and vanish for the rest of the week.
 *
 * SubjectSpreadConstraint already discourages two periods on the SAME day.
 * This one is about the days in between, which nothing else looks at.
 *
 * TWO MODES, BECAUSE THEY ARE GENUINELY DIFFERENT QUESTIONS
 *
 *   EVERY_DAY   For Maths, Science, English. Charges for landing on a day the
 *               subject already occupies while some other day still has none.
 *               The effect is one period per day first, extras afterwards.
 *
 *   SPREAD_OUT  For Computer Lab, Games, Art, Library. Works out the ideal
 *               spacing (working days ÷ periods per week) and charges for
 *               every day the placement falls short of it. Two periods across
 *               six days want a gap of three, so Monday+Thursday costs
 *               nothing and Monday+Tuesday costs two.
 *
 * Distance is measured around the week rather than along it, so Saturday and
 * Monday count as neighbours and a subject cannot cluster at both ends and
 * call itself spread out.
 */

import { ISoftConstraint } from '../IConstraint.js';
import { Spread } from '../../../utils/Constants.js';

/** Charge for doubling up on a day while another day is still empty. */
const REPEAT_BEFORE_COVERAGE_COST = 2;

export class WeeklyDistributionConstraint extends ISoftConstraint {
  /** @returns {string} */
  get id() { return 'weekly-distribution'; }

  /** @returns {string} */
  get weightKey() { return 'weeklyDistribution'; }

  /**
   * @param {import('../../Placement.js').Placement} placement
   * @param {import('../../ScheduleState.js').ScheduleState} state
   * @param {import('../../SchedulingContext.js').SchedulingContext} context
   * @returns {number}
   */
  penalty(placement, state, context) {
    const { classId, subjectId, spread, periodsPerWeek } = placement.demand;
    if (spread === Spread.FLEXIBLE) return 0;

    const occupied = state.subjectDays(classId, subjectId);
    if (occupied.size === 0) return 0;

    const dayCount = context.timeGrid.dayCount;

    // A consecutive block sits on one day; charging once per period would
    // penalise a double lab twice for a single scheduling decision.
    const targetDays = new Set();
    for (const slot of placement.slots) targetDays.add(slot.dayIndex);

    return spread === Spread.EVERY_DAY
      ? this._dailyCoveragePenalty(targetDays, occupied, dayCount)
      : this._spacingPenalty(targetDays, occupied, dayCount, periodsPerWeek);
  }

  /**
   * "One on every day before a second on any day."
   * @private
   * @param {Set<number>} targetDays
   * @param {Set<number>} occupied
   * @param {number} dayCount
   * @returns {number}
   */
  _dailyCoveragePenalty(targetDays, occupied, dayCount) {
    // Once every day is covered there is no coverage left to protect, so
    // further periods are free to go wherever else scores best.
    if (occupied.size >= dayCount) return 0;

    let total = 0;
    for (const day of targetDays) {
      if (occupied.has(day)) total += REPEAT_BEFORE_COVERAGE_COST;
    }
    return total;
  }

  /**
   * "Put the periods as far apart as the week allows."
   * @private
   * @param {Set<number>} targetDays
   * @param {Set<number>} occupied
   * @param {number} dayCount
   * @param {number} periodsPerWeek
   * @returns {number}
   */
  _spacingPenalty(targetDays, occupied, dayCount, periodsPerWeek) {
    const idealGap = Math.max(1, Math.floor(dayCount / Math.max(1, periodsPerWeek)));

    let total = 0;
    for (const day of targetDays) {
      let nearest = Number.POSITIVE_INFINITY;
      for (const other of occupied) {
        const gap = WeeklyDistributionConstraint._weekDistance(day, other, dayCount);
        if (gap < nearest) nearest = gap;
        if (nearest === 0) break;
      }
      total += Math.max(0, idealGap - nearest);
    }
    return total;
  }

  /**
   * Shortest distance between two days treating the week as a loop.
   * @private
   * @param {number} a
   * @param {number} b
   * @param {number} dayCount
   * @returns {number}
   */
  static _weekDistance(a, b, dayCount) {
    const direct = Math.abs(a - b);
    return Math.min(direct, dayCount - direct);
  }

  /**
   * @param {import('../../Placement.js').Placement} placement
   * @returns {string}
   */
  describe(placement) {
    return placement.demand.spread === Spread.EVERY_DAY
      ? 'Repeats on one day while another day has none of this subject'
      : 'Periods of this subject are bunched too close together in the week';
  }
}
