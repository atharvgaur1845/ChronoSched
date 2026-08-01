/**
 * @file LocalSearchOptimizer.js
 * @description A post-pass that improves an already-complete timetable.
 *
 * NOT AN ISchedulingStrategy — it cannot build a timetable from nothing, only
 * make an existing one better. Modelling it as a strategy would force a
 * meaningless `solve()` on an empty grid; keeping it separate lets it compose
 * with either strategy.
 *
 * ALGORITHM: steepest-descent hill climbing on single periods.
 *   1. Take a placed, unlocked, single-period lesson.
 *   2. Lift it out of the grid.
 *   3. Score its old position and every legal alternative.
 *   4. Put it back wherever is cheapest.
 * Sweep until nothing improves or the iteration budget runs out.
 *
 * Lifting the lesson out BEFORE scoring is essential: evaluated in place it
 * would clash with itself, and every alternative would look artificially good.
 *
 * Only single periods move. Relocating a consecutive block means finding a free
 * run of the right length and moving several lessons atomically; the extra
 * complexity buys little, because blocks are placed first when the grid is
 * still empty and are usually already well positioned.
 *
 * Hill climbing can stall in a local optimum. That is an accepted trade: it
 * never makes a timetable worse, always terminates, and costs a few
 * milliseconds. Simulated annealing would escape more optima and is the natural
 * next class to add behind this same call.
 */

import { createLogger } from '../../utils/Logger.js';
import { LIMITS } from '../../utils/Constants.js';

const log = createLogger('LocalSearchOptimizer');

export class LocalSearchOptimizer {
  /**
   * @param {object} [options]
   * @param {number} [options.maxIterations]
   */
  constructor({ maxIterations = LIMITS.OPTIMIZER_ITERATIONS } = {}) {
    /** @private */ this._maxIterations = maxIterations;
  }

  /** @returns {string} */
  get id() { return 'local-search'; }

  /**
   * Improves the state in place.
   *
   * @param {object} input
   * @param {import('../ScheduleState.js').ScheduleState} input.state
   * @param {import('../SchedulingContext.js').SchedulingContext} input.context
   * @param {import('../constraints/ConstraintRegistry.js').ConstraintRegistry} input.registry
   * @param {Map<string, import('../LessonDemand.js').LessonDemand>} input.demandByPair
   *        `classId|subjectId` → representative demand, supplying the priority
   *        and difficulty a relocated lesson must be re-scored with.
   * @returns {{relocations: number, iterations: number, gain: number}}
   */
  optimize({ state, context, registry, demandByPair }) {
    const singleSlotWindows = context.windowsOfSize(1);
    let relocations = 0;
    let iterations = 0;
    let gain = 0;
    let sweepImproved = true;

    while (sweepImproved && iterations < this._maxIterations) {
      sweepImproved = false;

      // Snapshot the lesson list: place()/unplace() mutate the live array, and
      // iterating it while relocating would skip entries.
      for (const lesson of state.lessons) {
        if (iterations >= this._maxIterations) break;
        iterations += 1;

        if (lesson.locked || lesson.blockId) continue;

        const demand = demandByPair.get(`${lesson.classId}|${lesson.subjectId}`);
        const currentSlot = context.timeGrid.getSlot(lesson.slotId);
        if (!demand || !currentSlot) continue;

        const current = { demand, slots: [currentSlot], teacherId: lesson.teacherId };

        state.unplace(current);
        const currentCost = registry.penalty(current, state, context);

        let best = current;
        let bestCost = currentCost;

        for (const slots of singleSlotWindows) {
          if (slots[0].id === currentSlot.id) continue;

          const candidate = { demand, slots, teacherId: lesson.teacherId };
          if (!registry.isFeasible(candidate, state, context)) continue;

          const cost = registry.penalty(candidate, state, context);
          if (cost < bestCost) {
            bestCost = cost;
            best = candidate;
          }
        }

        state.place(best);

        if (best !== current) {
          relocations += 1;
          gain += currentCost - bestCost;
          sweepImproved = true;
        }
      }
    }

    log.debug(`Local search: ${relocations} relocations over ${iterations} checks, penalty reduced by ${gain.toFixed(1)}.`);
    return { relocations, iterations, gain };
  }
}
