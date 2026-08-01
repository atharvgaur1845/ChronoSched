/**
 * @file Teacher.js
 * @description A member of teaching staff, including the availability and
 * workload rules the scheduler must respect.
 *
 * Two kinds of slot preference are modelled and they are NOT the same thing:
 *
 *   unavailableSlots   HARD. The teacher is not in the building. The scheduler
 *                      may never place a lesson here, at any cost.
 *   preferredFreeSlots SOFT. The teacher would like this period free. The
 *                      scheduler avoids it when an alternative exists.
 *
 * Collapsing them into one list is the single most common way a timetable
 * generator becomes unsolvable, so they stay separate all the way down.
 */

import { Entity } from '../core/Entity.js';
import { Result } from '../core/Result.js';

/**
 * @typedef {object} SlotRef
 * @property {number} dayIndex
 * @property {number|null} periodIndex `null` means the entire day.
 */

/** Sentinel used in the lookup set for a whole-day entry. */
const WHOLE_DAY = '*';

export class Teacher extends Entity {
  /**
   * @param {object} data
   * @param {string} data.id
   * @param {string} data.name
   * @param {string} [data.employeeId]        School's own staff number.
   * @param {string[]} [data.subjectIds]      Subjects this teacher is qualified for.
   * @param {string[]} [data.classIds]        Classes they may teach; empty means any.
   * @param {number} [data.maxPeriodsPerDay]
   * @param {number} [data.maxPeriodsPerWeek]
   * @param {SlotRef[]} [data.unavailableSlots]
   * @param {SlotRef[]} [data.preferredFreeSlots]
   */
  constructor({
    id, name, employeeId, subjectIds, classIds,
    maxPeriodsPerDay, maxPeriodsPerWeek, unavailableSlots, preferredFreeSlots,
  }) {
    super(id);

    /** @type {string} */
    this.name = String(name ?? '').trim();
    /** @type {string} */
    this.employeeId = String(employeeId ?? '').trim();
    /** @type {string[]} */
    this.subjectIds = [...(subjectIds ?? [])];
    /** @type {string[]} Empty array means "eligible for every class". */
    this.classIds = [...(classIds ?? [])];
    /** @type {number} */
    this.maxPeriodsPerDay = Number(maxPeriodsPerDay ?? 6);
    /** @type {number} */
    this.maxPeriodsPerWeek = Number(maxPeriodsPerWeek ?? 30);
    /** @type {SlotRef[]} */
    this.unavailableSlots = Teacher._normaliseSlots(unavailableSlots);
    /** @type {SlotRef[]} */
    this.preferredFreeSlots = Teacher._normaliseSlots(preferredFreeSlots);

    /**
     * @private @type {Set<string>}
     * Precomputed lookup so the scheduler's hard-constraint check is O(1)
     * rather than a linear scan of unavailableSlots on every candidate.
     */
    this._unavailableKeys = Teacher._buildKeySet(this.unavailableSlots);
    /** @private @type {Set<string>} */
    this._preferredFreeKeys = Teacher._buildKeySet(this.preferredFreeSlots);
  }

  /**
   * @private
   * @param {SlotRef[]|undefined} slots
   * @returns {SlotRef[]}
   */
  static _normaliseSlots(slots) {
    return (slots ?? []).map((slot) => ({
      dayIndex: Number(slot.dayIndex),
      periodIndex: slot.periodIndex === null || slot.periodIndex === undefined
        ? null
        : Number(slot.periodIndex),
    }));
  }

  /**
   * @private
   * @param {SlotRef[]} slots
   * @returns {Set<string>}
   */
  static _buildKeySet(slots) {
    return new Set(slots.map((slot) => Teacher._slotKey(
      slot.dayIndex,
      slot.periodIndex === null ? WHOLE_DAY : slot.periodIndex,
    )));
  }

  /**
   * @private
   * @param {number} dayIndex
   * @param {number|string} periodIndex
   * @returns {string}
   */
  static _slotKey(dayIndex, periodIndex) {
    return `${dayIndex}:${periodIndex}`;
  }

  /** @returns {string} */
  get displayName() {
    return this.name;
  }

  /** @returns {string} e.g. "A. Sharma (EMP-1042)". */
  get labelWithId() {
    return this.employeeId ? `${this.name} (${this.employeeId})` : this.name;
  }

  /**
   * HARD availability check. O(1).
   * @param {number} dayIndex
   * @param {number} periodIndex
   * @returns {boolean}
   */
  isAvailableAt(dayIndex, periodIndex) {
    return !this._unavailableKeys.has(Teacher._slotKey(dayIndex, periodIndex))
        && !this._unavailableKeys.has(Teacher._slotKey(dayIndex, WHOLE_DAY));
  }

  /**
   * SOFT preference check. O(1).
   * @param {number} dayIndex
   * @param {number} periodIndex
   * @returns {boolean}
   */
  prefersFreeAt(dayIndex, periodIndex) {
    return this._preferredFreeKeys.has(Teacher._slotKey(dayIndex, periodIndex))
        || this._preferredFreeKeys.has(Teacher._slotKey(dayIndex, WHOLE_DAY));
  }

  /**
   * Whether this teacher may take the given subject for the given class.
   * An empty classIds list means no class restriction.
   * @param {string} subjectId
   * @param {string} classId
   * @returns {boolean}
   */
  canTeach(subjectId, classId) {
    if (!this.subjectIds.includes(subjectId)) return false;
    return this.classIds.length === 0 || this.classIds.includes(classId);
  }

  /**
   * Count of slots this teacher is unavailable for in a given week shape.
   * Used by the demand orderer: the most constrained teacher picks first.
   * @param {number} dayCount
   * @param {number} periodCount
   * @returns {number}
   */
  countUnavailable(dayCount, periodCount) {
    let total = 0;
    for (const slot of this.unavailableSlots) {
      if (slot.dayIndex >= dayCount) continue;
      total += slot.periodIndex === null ? periodCount : 1;
    }
    return total;
  }

  /** @returns {Result} */
  validate() {
    const errors = [];
    const warnings = [];

    if (this.name.length === 0) errors.push('Teacher name is required.');
    if (this.subjectIds.length === 0) warnings.push(`${this.name || 'This teacher'} has no subjects, so they cannot be auto-assigned.`);

    if (!Number.isFinite(this.maxPeriodsPerDay) || this.maxPeriodsPerDay < 0) {
      errors.push('Maximum periods per day must be zero or more.');
    }
    if (!Number.isFinite(this.maxPeriodsPerWeek) || this.maxPeriodsPerWeek < 0) {
      errors.push('Maximum periods per week must be zero or more.');
    }
    if (this.maxPeriodsPerWeek < this.maxPeriodsPerDay) {
      warnings.push(`${this.name}'s weekly limit (${this.maxPeriodsPerWeek}) is below their daily limit (${this.maxPeriodsPerDay}).`);
    }

    return errors.length > 0 ? Result.fail(errors, warnings) : Result.ok(this, warnings);
  }

  /** @returns {object} */
  toJSON() {
    return {
      id: this.id,
      name: this.name,
      employeeId: this.employeeId,
      subjectIds: [...this.subjectIds],
      classIds: [...this.classIds],
      maxPeriodsPerDay: this.maxPeriodsPerDay,
      maxPeriodsPerWeek: this.maxPeriodsPerWeek,
      unavailableSlots: this.unavailableSlots.map((slot) => ({ ...slot })),
      preferredFreeSlots: this.preferredFreeSlots.map((slot) => ({ ...slot })),
    };
  }
}
