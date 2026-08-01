/**
 * @file ConstraintRegistry.js
 * @description Holds the active rule set and evaluates placements against it.
 *
 * This is the Open/Closed seam of the whole application. Adding "a class must
 * not have two labs on the same day" means writing one constraint file and
 * registering it here. Scheduler.js, every strategy, and ValidationService are
 * untouched — and because manual drag-and-drop validates through this same
 * registry, the new rule automatically applies to hand edits too.
 *
 * That shared path is the reason there is exactly one definition of "legal" in
 * the codebase, rather than one in the solver and a slightly different one in
 * the UI that drifts apart over a year of maintenance.
 */

import { IConstraint, ISoftConstraint } from './IConstraint.js';

export class ConstraintRegistry {
  constructor() {
    /** @private @type {IConstraint[]} */
    this._hard = [];
    /** @private @type {ISoftConstraint[]} */
    this._soft = [];
  }

  /**
   * @param {IConstraint} constraint
   * @returns {this} For chaining during composition.
   */
  registerHard(constraint) {
    if (!(constraint instanceof IConstraint)) {
      throw new TypeError('registerHard() expects an IConstraint.');
    }
    this._hard.push(constraint);
    return this;
  }

  /**
   * @param {ISoftConstraint} constraint
   * @returns {this}
   */
  registerSoft(constraint) {
    if (!(constraint instanceof ISoftConstraint)) {
      throw new TypeError('registerSoft() expects an ISoftConstraint.');
    }
    this._soft.push(constraint);
    return this;
  }

  /** @returns {IConstraint[]} */
  get hardConstraints() { return [...this._hard]; }

  /** @returns {ISoftConstraint[]} */
  get softConstraints() { return [...this._soft]; }

  /**
   * Fast path used inside the solver loop: is this placement legal?
   *
   * Returns on the first failure, so cheap constraints registered first (map
   * lookups) short-circuit the more expensive ones.
   *
   * @param {import('../Placement.js').Placement} placement
   * @param {import('../ScheduleState.js').ScheduleState} state
   * @param {import('../SchedulingContext.js').SchedulingContext} context
   * @returns {boolean}
   */
  isFeasible(placement, state, context) {
    for (const constraint of this._hard) {
      if (!constraint.isSatisfied(placement, state, context)) return false;
    }
    return true;
  }

  /**
   * Slow path used by the UI: which rule blocked this, and why?
   * @param {import('../Placement.js').Placement} placement
   * @param {import('../ScheduleState.js').ScheduleState} state
   * @param {import('../SchedulingContext.js').SchedulingContext} context
   * @returns {{constraint: IConstraint, reason: string}|null} Null when legal.
   */
  firstViolation(placement, state, context) {
    for (const constraint of this._hard) {
      if (!constraint.isSatisfied(placement, state, context)) {
        return { constraint, reason: constraint.explain(placement, state, context) };
      }
    }
    return null;
  }

  /**
   * Every rule broken by a placement, not just the first. Used by the
   * pre-generation health check where the administrator wants the full list.
   * @param {import('../Placement.js').Placement} placement
   * @param {import('../ScheduleState.js').ScheduleState} state
   * @param {import('../SchedulingContext.js').SchedulingContext} context
   * @returns {Array<{constraint: IConstraint, reason: string}>}
   */
  allViolations(placement, state, context) {
    const violations = [];
    for (const constraint of this._hard) {
      if (!constraint.isSatisfied(placement, state, context)) {
        violations.push({ constraint, reason: constraint.explain(placement, state, context) });
      }
    }
    return violations;
  }

  /**
   * Weighted total cost of a legal placement. Lower is better.
   * @param {import('../Placement.js').Placement} placement
   * @param {import('../ScheduleState.js').ScheduleState} state
   * @param {import('../SchedulingContext.js').SchedulingContext} context
   * @returns {number}
   */
  penalty(placement, state, context) {
    let total = 0;
    for (const constraint of this._soft) {
      const raw = constraint.penalty(placement, state, context);
      if (raw !== 0) total += raw * context.weightFor(constraint.weightKey);
    }
    return total;
  }

  /**
   * Per-rule penalty breakdown, so the quality report can say *which*
   * preference the timetable is paying for.
   * @param {import('../Placement.js').Placement} placement
   * @param {import('../ScheduleState.js').ScheduleState} state
   * @param {import('../SchedulingContext.js').SchedulingContext} context
   * @returns {Map<string, number>}
   */
  penaltyBreakdown(placement, state, context) {
    const breakdown = new Map();
    for (const constraint of this._soft) {
      const raw = constraint.penalty(placement, state, context);
      if (raw !== 0) breakdown.set(constraint.id, raw * context.weightFor(constraint.weightKey));
    }
    return breakdown;
  }
}
