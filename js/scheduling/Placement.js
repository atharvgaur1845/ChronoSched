/**
 * @file Placement.js
 * @description A candidate answer to one {@link LessonDemand}: which slots and
 * which teacher.
 *
 * Kept as a plain frozen object rather than a class with behaviour because the
 * solver creates tens of thousands of these per run and every one is inspected
 * by six constraints. Methods on it would add prototype lookups to the hottest
 * path for no readability gain — the constraints already read it as data.
 */

/**
 * @typedef {object} Placement
 * @property {import('./LessonDemand.js').LessonDemand} demand
 * @property {import('../domain/TimeSlot.js').TimeSlot[]} slots Consecutive; length === demand.size.
 * @property {string|null} teacherId
 */

/**
 * Builds a placement.
 * @param {import('./LessonDemand.js').LessonDemand} demand
 * @param {import('../domain/TimeSlot.js').TimeSlot[]} slots
 * @param {string|null} teacherId
 * @returns {Placement}
 */
export function createPlacement(demand, slots, teacherId) {
  return { demand, slots, teacherId };
}

/**
 * Short human description used in reports and validation messages.
 * @param {Placement} placement
 * @returns {string}
 */
export function describePlacement(placement) {
  const first = placement.slots[0];
  const span = placement.slots.length > 1
    ? `P${first.periodNumber}–P${placement.slots[placement.slots.length - 1].periodNumber}`
    : `P${first.periodNumber}`;
  return `${first.dayLabel} ${span}`;
}
