/**
 * @file GreedyHeuristicStrategy.js
 * @description Places every demand in its cheapest legal slot, never revisiting
 * a decision.
 *
 * CHARACTERISTICS
 *   Time      O(demands × slots × teachers × hardConstraints) — linear, fast.
 *   Guarantee None. A demand can become unplaceable because of an earlier
 *             choice, and this strategy will not go back to fix it.
 *   Use for   Instant previews, loosely-constrained schools, and as a baseline
 *             to compare the thorough strategy against.
 *
 * Which demands ended up unplaced is derived by the Scheduler from the final
 * state rather than tracked here, so both strategies report identically and
 * neither can disagree with the grid it actually produced.
 */

import { ISchedulingStrategy } from './ISchedulingStrategy.js';
import { StrategyId } from '../../utils/Constants.js';

export class GreedyHeuristicStrategy extends ISchedulingStrategy {
  /** @returns {string} */
  get id() { return StrategyId.GREEDY; }

  /** @returns {string} */
  get displayName() { return 'Fast (greedy)'; }

  /** @returns {string} */
  get description() {
    return 'Fills the timetable in one pass, always taking the best-looking slot. '
      + 'Finishes almost instantly, but may leave a few periods unplaced when the '
      + 'school is tightly constrained.';
  }

  /**
   * @param {object} input
   * @param {import('../LessonDemand.js').LessonDemand[]} input.demands
   * @param {import('../ScheduleState.js').ScheduleState} input.state
   * @param {import('../SchedulingContext.js').SchedulingContext} input.context
   * @param {import('../constraints/ConstraintRegistry.js').ConstraintRegistry} input.registry
   * @param {() => number} input.random
   * @returns {{nodesExplored: number, budgetExhausted: boolean}}
   */
  solve({ demands, state, context, registry, random }) {
    let nodesExplored = 0;

    for (const demand of demands) {
      const candidates = this._rankedCandidates(demand, state, context, registry, random);
      nodesExplored += 1;
      if (candidates.length > 0) state.place(candidates[0].placement);
    }

    return { nodesExplored, budgetExhausted: false };
  }
}
