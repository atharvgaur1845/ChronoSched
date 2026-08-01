/**
 * @file CorePeriodWindowConstraint.js
 * @description SOFT — main subjects belong in the early periods.
 *
 * This implements the brief's rule "a class should have main subjects
 * continuously from the 1st to the 6th period, then other subjects".
 *
 * WHY SOFT, AND WHY A CONFIGURABLE WINDOW
 * As a hard constraint the rule makes most real schools unsolvable: a class
 * with 30 core periods a week and a 6-period window has only 36 core slots
 * across six days, leaving no room for the solver to resolve teacher clashes.
 * Hard-coding "1 to 6" additionally breaks any school with a different day
 * length. So the window lives in Settings and the rule carries a price
 * (default weight 10 — the highest of any preference) rather than a veto.
 *
 * The penalty works in both directions, which is what produces the
 * "continuously ... then other subjects" shape rather than merely "core early":
 *   - a core subject placed after the window is charged by how far past it sits,
 *   - a non-core subject sitting inside the window is charged a flat amount,
 *     so it moves aside unless the grid genuinely has nowhere else for it.
 */

import { ISoftConstraint } from '../IConstraint.js';

/** Charge for an elective occupying a slot the core subjects want. */
const ELECTIVE_INTRUSION_COST = 0.75;

export class CorePeriodWindowConstraint extends ISoftConstraint {
  /** @returns {string} */
  get id() { return 'core-period-window'; }

  /** @returns {string} */
  get weightKey() { return 'corePeriodWindow'; }

  /**
   * @param {import('../../Placement.js').Placement} placement
   * @param {import('../../ScheduleState.js').ScheduleState} _state
   * @param {import('../../SchedulingContext.js').SchedulingContext} context
   * @returns {number}
   */
  penalty(placement, _state, context) {
    const { from, to } = context.corePeriodWindow;
    const isCore = placement.demand.isCore;
    let total = 0;

    for (const slot of placement.slots) {
      const period = slot.periodNumber;

      if (isCore) {
        // Distance-based so period 7 is preferred over period 8, giving the
        // solver a gradient to descend rather than a flat cliff.
        if (period > to) total += period - to;
        else if (period < from) total += from - period;
      } else if (period >= from && period <= to) {
        total += ELECTIVE_INTRUSION_COST;
      }
    }
    return total;
  }

  /**
   * @param {import('../../Placement.js').Placement} placement
   * @returns {string}
   */
  describe(placement) {
    return placement.demand.isCore
      ? 'Main subject scheduled outside the preferred early periods'
      : 'Non-core subject occupying an early period';
  }
}
