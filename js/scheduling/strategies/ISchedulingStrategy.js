/**
 * @file ISchedulingStrategy.js
 * @description The Strategy interface for timetable generation.
 *
 * WHY A STRATEGY PATTERN HERE
 * There is no single best scheduling algorithm. A school with loose constraints
 * wants an instant greedy pass; a tightly-constrained one needs backtracking
 * and will accept a few seconds. Rather than one function with a `mode` flag
 * and branches throughout, each algorithm is a class behind this interface.
 *
 * The payoff is concrete: adding simulated annealing or a genetic solver later
 * means writing one class and registering it. Scheduler.js, the constraint
 * registry, the report, and every line of UI stay exactly as they are.
 *
 * A strategy MUST NOT know about the DOM, storage, or events. It receives
 * immutable context plus a mutable state and returns placements. That is what
 * makes the algorithm testable in isolation and reusable server-side.
 */

/** Shared helpers live here so both concrete strategies stay short. */
export class ISchedulingStrategy {
  constructor() {
    if (new.target === ISchedulingStrategy) {
      throw new TypeError('ISchedulingStrategy is an interface and cannot be instantiated.');
    }
  }

  /**
   * Stable identifier, stored on the Timetable so a version records how it was
   * produced.
   * @abstract
   * @returns {string}
   */
  get id() {
    throw new Error(`${this.constructor.name} must implement get id().`);
  }

  /** @abstract @returns {string} Name shown in the Generate screen. */
  get displayName() {
    throw new Error(`${this.constructor.name} must implement get displayName().`);
  }

  /** @abstract @returns {string} One-line explanation for the administrator. */
  get description() {
    throw new Error(`${this.constructor.name} must implement get description().`);
  }

  /**
   * Places as many demands as possible.
   *
   * Implementations mutate `state` via place()/unplace() and return the
   * demands they could not satisfy. They must never throw for an unsolvable
   * input — an unsolvable school is a reportable outcome, not an error.
   *
   * @abstract
   * @param {object} _input
   * @param {import('../LessonDemand.js').LessonDemand[]} _input.demands Pre-ordered.
   * @param {import('../ScheduleState.js').ScheduleState} _input.state
   * @param {import('../SchedulingContext.js').SchedulingContext} _input.context
   * @param {import('../constraints/ConstraintRegistry.js').ConstraintRegistry} _input.registry
   * @param {() => number} _input.random Seeded RNG, for reproducible tie-breaks.
   * @returns {{unplaced: Array<{demand: import('../LessonDemand.js').LessonDemand, reason: string}>, nodesExplored: number}}
   */
  solve(_input) {
    throw new Error(`${this.constructor.name} must implement solve().`);
  }

  /**
   * Enumerates every legal placement for one demand, cheapest first.
   *
   * Shared by both strategies because candidate generation is identical — only
   * what they do with the list differs. Duplicating it would guarantee the two
   * drift apart.
   *
   * @protected
   * @param {import('../LessonDemand.js').LessonDemand} demand
   * @param {import('../ScheduleState.js').ScheduleState} state
   * @param {import('../SchedulingContext.js').SchedulingContext} context
   * @param {import('../constraints/ConstraintRegistry.js').ConstraintRegistry} registry
   * @param {() => number} random
   * @returns {Array<{placement: import('../Placement.js').Placement, cost: number}>}
   */
  _rankedCandidates(demand, state, context, registry, random) {
    const windows = context.windowsOfSize(demand.size);
    const teachers = context.eligibleTeachersFor(demand);
    const candidates = [];

    // An empty teacher pool still produces candidates with teacherId === null:
    // an unstaffed period is a visible problem the administrator can fix,
    // whereas a silently missing period is not.
    const teacherIds = teachers.length > 0 ? teachers.map((teacher) => teacher.id) : [null];

    for (const slots of windows) {
      for (const teacherId of teacherIds) {
        const placement = { demand, slots, teacherId };
        if (!registry.isFeasible(placement, state, context)) continue;

        // A small jitter breaks ties differently on each generation, so
        // pressing Generate twice yields genuinely different versions to
        // compare rather than an identical grid.
        const cost = registry.penalty(placement, state, context) + random() * 0.001;
        candidates.push({ placement, cost });
      }
    }

    candidates.sort((left, right) => left.cost - right.cost);
    return candidates;
  }

  /**
   * Best-guess explanation for why nothing could be placed. Reported verbatim
   * to the administrator, so it names the likely fix.
   *
   * @protected
   * @param {import('../LessonDemand.js').LessonDemand} demand
   * @param {import('../ScheduleState.js').ScheduleState} state
   * @param {import('../SchedulingContext.js').SchedulingContext} context
   * @param {import('../constraints/ConstraintRegistry.js').ConstraintRegistry} registry
   * @returns {string}
   */
  _diagnose(demand, state, context, registry) {
    const teachers = context.eligibleTeachersFor(demand);
    if (teachers.length === 0) {
      return demand.fixedTeacherId
        ? 'The assigned teacher no longer exists.'
        : 'No teacher is qualified for this subject and class.';
    }

    // Sample the grid and report the most frequent blocking rule — far more
    // useful than "no feasible slot".
    /** @type {Map<string, number>} */
    const tally = new Map();
    const windows = context.windowsOfSize(demand.size);

    for (const slots of windows) {
      for (const teacher of teachers) {
        const violation = registry.firstViolation({ demand, slots, teacherId: teacher.id }, state, context);
        if (violation) tally.set(violation.reason, (tally.get(violation.reason) ?? 0) + 1);
      }
    }

    let topReason = 'Every period is already taken by another commitment.';
    let topCount = 0;
    for (const [reason, count] of tally) {
      if (count > topCount) { topCount = count; topReason = reason; }
    }
    return topReason;
  }
}
