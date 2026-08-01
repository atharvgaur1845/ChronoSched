/**
 * @file BacktrackingStrategy.js
 * @description Depth-first search with chronological backtracking — the
 * production generator.
 *
 * HOW IT DIFFERS FROM GREEDY
 * Greedy commits to its first choice forever. This one, when a demand has no
 * legal slot left, undoes the previous placement and tries that demand's
 * second-best option instead. That is what lets it fit a double lab into a week
 * where the naive pass would have blocked the only free run.
 *
 * THE RECURSION CONTRACT (the part that is easy to get wrong)
 *   `_search(i)` returns the number of demands from `i` onward it could not
 *   place, and always leaves those it COULD place committed to the state.
 *   It never unwinds past its own frame. That invariant is what guarantees the
 *   caller always ends up with a complete, usable grid — a search that unwinds
 *   on failure would hand back an empty timetable for a school that is short by
 *   a single period.
 *
 * THREE THINGS KEEP IT FROM RUNNING FOREVER
 *   1. BRANCH LIMIT — only the best few candidates per demand are explored. The
 *      40th-ranked slot is almost never part of a good solution, and exploring
 *      it multiplies the search space for nothing.
 *   2. NODE BUDGET — a ceiling on placements attempted. Once spent, the branch
 *      factor collapses to 1 and the remainder is filled greedily, so the run
 *      degrades predictably instead of hanging the tab.
 *   3. ORDERING — demands arrive hardest-first from CurriculumExpander, which
 *      pushes failures near the root of the tree where they are cheap.
 *
 * This is a bounded search, not a proof of optimality, and does not claim to be.
 */

import { ISchedulingStrategy } from './ISchedulingStrategy.js';
import { StrategyId, LIMITS } from '../../utils/Constants.js';
import { createLogger } from '../../utils/Logger.js';

const log = createLogger('BacktrackingStrategy');

/** Candidates explored per demand before settling for the least-bad one. */
const DEFAULT_BRANCH_LIMIT = 4;

export class BacktrackingStrategy extends ISchedulingStrategy {
  /**
   * @param {object} [options]
   * @param {number} [options.branchLimit]
   * @param {number} [options.nodeBudget]
   */
  constructor({ branchLimit = DEFAULT_BRANCH_LIMIT, nodeBudget = LIMITS.SOLVER_NODE_BUDGET } = {}) {
    super();
    /** @private */ this._branchLimit = branchLimit;
    /** @private */ this._nodeBudget = nodeBudget;
  }

  /** @returns {string} */
  get id() { return StrategyId.BACKTRACKING; }

  /** @returns {string} */
  get displayName() { return 'Thorough (backtracking)'; }

  /** @returns {string} */
  get description() {
    return 'Explores alternatives and undoes earlier choices when they lead to a dead end. '
      + 'Takes a little longer but fits far more of the timetable, especially when labs '
      + 'and teacher limits are tight.';
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
    const counters = { nodes: 0 };
    const failures = this._search(0, demands, state, context, registry, random, counters);

    const budgetExhausted = counters.nodes >= this._nodeBudget;
    if (budgetExhausted) {
      log.warn(`Node budget of ${this._nodeBudget} reached; the remainder was filled greedily.`);
    }
    log.debug(`Backtracking finished: ${failures} unplaced, ${counters.nodes} nodes explored.`);

    return { nodesExplored: counters.nodes, budgetExhausted };
  }

  /**
   * @private
   * @param {number} index
   * @param {import('../LessonDemand.js').LessonDemand[]} demands
   * @param {import('../ScheduleState.js').ScheduleState} state
   * @param {import('../SchedulingContext.js').SchedulingContext} context
   * @param {import('../constraints/ConstraintRegistry.js').ConstraintRegistry} registry
   * @param {() => number} random
   * @param {{nodes: number}} counters
   * @returns {number} Count of demands from `index` onward left unplaced.
   */
  _search(index, demands, state, context, registry, random, counters) {
    if (index >= demands.length) return 0;

    const demand = demands[index];
    const candidates = this._rankedCandidates(demand, state, context, registry, random);

    // Nothing legal anywhere. Record the miss and carry on with the rest —
    // one impossible period must not cost the school its whole timetable.
    if (candidates.length === 0) {
      return 1 + this._search(index + 1, demands, state, context, registry, random, counters);
    }

    // Once the budget is spent the search degenerates to greedy, which is both
    // the termination guarantee and the reason the tail of a hard instance
    // still gets filled.
    const branchCount = counters.nodes >= this._nodeBudget
      ? 1
      : Math.min(this._branchLimit, candidates.length);

    let bestBranch = 0;
    let bestFailures = Number.POSITIVE_INFINITY;

    for (let branch = 0; branch < branchCount; branch += 1) {
      counters.nodes += 1;
      state.place(candidates[branch].placement);

      const failures = this._search(index + 1, demands, state, context, registry, random, counters);

      // A perfect subtree can never be improved on — stop immediately.
      if (failures === 0) return 0;

      const isLastBranch = branch === branchCount - 1 || counters.nodes >= this._nodeBudget;
      if (isLastBranch && failures <= bestFailures) {
        // Already the best option and already committed. Keeping it here is
        // what avoids re-running the subtree just to arrive back at this state.
        return failures;
      }

      if (failures < bestFailures) {
        bestFailures = failures;
        bestBranch = branch;
      }

      state.unplace(candidates[branch].placement);
      if (isLastBranch) break;
    }

    // Every explored branch left something unplaced. Commit to the least-bad
    // one and finish the tail. This replay is the only redundant work in the
    // algorithm, and it happens solely on subtrees that were going to fail.
    counters.nodes += 1;
    state.place(candidates[bestBranch].placement);
    return this._search(index + 1, demands, state, context, registry, random, counters);
  }
}
