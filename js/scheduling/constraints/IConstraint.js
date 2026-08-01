/**
 * @file IConstraint.js
 * @description Interfaces for the two kinds of scheduling rule.
 *
 * HARD vs SOFT IS THE CENTRAL DESIGN SPLIT OF THE SCHEDULER
 *
 *   Hard constraints FILTER. A placement that violates one is illegal and is
 *   never considered. "A teacher cannot be in two rooms at once" has no price;
 *   it simply cannot happen.
 *
 *   Soft constraints RANK. Every legal placement gets a penalty score, and the
 *   solver prefers the cheapest. "Core subjects should be in the morning" is a
 *   strong preference, but enforcing it absolutely would make most real schools
 *   unsolvable — there are more core periods than morning slots.
 *
 * Getting this split wrong is the most common way a timetable generator either
 * produces illegal output (soft when it should be hard) or reports "no solution
 * found" on perfectly reasonable input (hard when it should be soft).
 *
 * Both interfaces are single-method by design: adding a rule means adding one
 * file and one registry line, and the solver is never edited again — the
 * Open/Closed Principle with a concrete payoff.
 */

/**
 * A rule that must never be broken.
 * @abstract
 */
export class IConstraint {
  constructor() {
    if (new.target === IConstraint) {
      throw new TypeError('IConstraint is an interface and cannot be instantiated.');
    }
  }

  /**
   * Stable identifier, used in reports and diagnostics.
   * @abstract
   * @returns {string}
   */
  get id() {
    throw new Error(`${this.constructor.name} must implement get id().`);
  }

  /**
   * @abstract
   * @param {import('../Placement.js').Placement} _placement
   * @param {import('../ScheduleState.js').ScheduleState} _state
   * @param {import('../SchedulingContext.js').SchedulingContext} _context
   * @returns {boolean} True when the placement is allowed.
   */
  isSatisfied(_placement, _state, _context) {
    throw new Error(`${this.constructor.name} must implement isSatisfied().`);
  }

  /**
   * Plain-English reason the placement was rejected. Shown to the
   * administrator when a drag-and-drop is refused, so it must name the actual
   * people and periods involved rather than the rule's internal name.
   *
   * @param {import('../Placement.js').Placement} _placement
   * @param {import('../ScheduleState.js').ScheduleState} _state
   * @param {import('../SchedulingContext.js').SchedulingContext} _context
   * @returns {string}
   */
  explain(_placement, _state, _context) {
    return `Blocked by rule "${this.id}".`;
  }
}

/**
 * A preference that carries a price rather than a prohibition.
 * @abstract
 */
export class ISoftConstraint {
  constructor() {
    if (new.target === ISoftConstraint) {
      throw new TypeError('ISoftConstraint is an interface and cannot be instantiated.');
    }
  }

  /**
   * @abstract
   * @returns {string}
   */
  get id() {
    throw new Error(`${this.constructor.name} must implement get id().`);
  }

  /**
   * Key into `Settings.constraintWeights`, so an administrator can retune this
   * rule's importance from the UI without a code change.
   * @abstract
   * @returns {string}
   */
  get weightKey() {
    throw new Error(`${this.constructor.name} must implement get weightKey().`);
  }

  /**
   * Unweighted cost of this placement. 0 means "perfectly happy". The registry
   * multiplies by the configured weight, so implementations should keep their
   * raw output on a comparable 0–10ish scale or weights become meaningless.
   *
   * @abstract
   * @param {import('../Placement.js').Placement} _placement
   * @param {import('../ScheduleState.js').ScheduleState} _state
   * @param {import('../SchedulingContext.js').SchedulingContext} _context
   * @returns {number}
   */
  penalty(_placement, _state, _context) {
    throw new Error(`${this.constructor.name} must implement penalty().`);
  }

  /**
   * Human description of why a penalty was charged, for the quality report.
   * @param {import('../Placement.js').Placement} _placement
   * @returns {string}
   */
  describe(_placement) {
    return this.id;
  }
}
