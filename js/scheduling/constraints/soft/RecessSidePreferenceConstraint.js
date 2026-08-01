/**
 * @file RecessSidePreferenceConstraint.js
 * @description SOFT — honour a subject's "before recess" / "after recess" wish.
 *
 * Soft because a class can easily want more before-recess periods than exist:
 * with recess after period 4, only 24 of a six-day week's 48 slots are "before".
 * Charging a price lets the solver satisfy as many preferences as the grid
 * allows and spend the rest, instead of failing outright.
 */

import { ISoftConstraint } from '../IConstraint.js';
import { RecessSide } from '../../../utils/Constants.js';

export class RecessSidePreferenceConstraint extends ISoftConstraint {
  /** @returns {string} */
  get id() { return 'recess-side-preference'; }

  /** @returns {string} */
  get weightKey() { return 'recessSidePreference'; }

  /**
   * @param {import('../../Placement.js').Placement} placement
   * @param {import('../../ScheduleState.js').ScheduleState} _state
   * @param {import('../../SchedulingContext.js').SchedulingContext} context
   * @returns {number}
   */
  penalty(placement, _state, context) {
    const preference = placement.demand.recessPreference;
    if (preference === RecessSide.ANY) return 0;

    // With no recess configured there is no "before" or "after" to honour, so
    // the preference is silently inert rather than penalising every placement.
    if (!context.recessPreferencesActive) return 0;

    const wantsBefore = preference === RecessSide.BEFORE;
    let total = 0;
    for (const slot of placement.slots) {
      if (slot.isBeforeRecess !== wantsBefore) total += 1;
    }
    return total;
  }

  /**
   * @param {import('../../Placement.js').Placement} placement
   * @returns {string}
   */
  describe(placement) {
    return `Scheduled on the wrong side of recess (wanted ${placement.demand.recessPreference.toLowerCase()})`;
  }
}
