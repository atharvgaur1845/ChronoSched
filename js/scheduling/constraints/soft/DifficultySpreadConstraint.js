/**
 * @file DifficultySpreadConstraint.js
 * @description SOFT — spread demanding subjects evenly across the week.
 *
 * Implements the brief's "distribute difficult subjects evenly". Each subject
 * carries a difficulty of 1–5; the constraint compares a day's accumulated
 * difficulty against the class's weekly average and charges for the excess.
 *
 * Only the OVERSHOOT is charged, not the raw total. Penalising total difficulty
 * would make the solver prefer leaving hard subjects unplaced entirely, which
 * is worse than a slightly heavy Tuesday.
 */

import { ISoftConstraint } from '../IConstraint.js';

/** Divisor keeping the raw output on roughly the same 0–10 scale as its peers. */
const SCALE = 4;

export class DifficultySpreadConstraint extends ISoftConstraint {
  /** @returns {string} */
  get id() { return 'difficulty-spread'; }

  /** @returns {string} */
  get weightKey() { return 'difficultySpread'; }

  /**
   * @param {import('../../Placement.js').Placement} placement
   * @param {import('../../ScheduleState.js').ScheduleState} state
   * @param {import('../../SchedulingContext.js').SchedulingContext} context
   * @returns {number}
   */
  penalty(placement, state, context) {
    const { classId, difficulty } = placement.demand;
    const target = context.targetDailyDifficulty(classId);
    if (target <= 0) return 0;

    /** @type {Map<number, number>} dayIndex → difficulty being added */
    const additionsByDay = new Map();
    for (const slot of placement.slots) {
      additionsByDay.set(slot.dayIndex, (additionsByDay.get(slot.dayIndex) ?? 0) + difficulty);
    }

    let total = 0;
    for (const [dayIndex, adding] of additionsByDay) {
      const current = state.classDayDifficulty(classId, dayIndex);
      const overshootBefore = Math.max(0, current - target);
      const overshootAfter = Math.max(0, current + adding - target);
      total += (overshootAfter - overshootBefore) / SCALE;
    }
    return total;
  }

  /** @returns {string} */
  describe() {
    return 'Concentrates demanding subjects on one day';
  }
}
