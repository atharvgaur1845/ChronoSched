/**
 * @file CurriculumEntry.js
 * @description "Class X studies Subject Y for N periods a week, under these rules."
 *
 * This is the scheduler's actual input and the busiest entity in the model.
 * The brief described these fields as properties of Subject; they live here
 * instead because every one of them varies per class:
 *
 *   10A takes Mathematics 6 periods/week before recess with Mr Sharma,
 *   12 Commerce takes Mathematics 4 periods/week, any time, with Mrs Rao.
 *
 * Same subject, different rules. One Subject row, two CurriculumEntry rows.
 */

import { Entity } from '../core/Entity.js';
import { Result } from '../core/Result.js';
import { Priority, RecessSide, PRIORITY_RANK } from '../utils/Constants.js';

export class CurriculumEntry extends Entity {
  /**
   * @param {object} data
   * @param {string} data.id
   * @param {string} data.classId
   * @param {string} data.subjectId
   * @param {string|null} [data.teacherId]      `null` asks the scheduler to choose.
   * @param {number} [data.periodsPerWeek]      Total periods to place. Authoritative.
   * @param {number} [data.maxPerDay]           Cap for one day. HARD constraint.
   * @param {string} [data.priority]            One of {@link Priority}.
   * @param {string} [data.recessPreference]    One of {@link RecessSide}.
   * @param {boolean} [data.requiresConsecutive]
   * @param {number} [data.consecutiveBlock]    Periods per block when consecutive.
   */
  constructor({
    id, classId, subjectId, teacherId,
    periodsPerWeek, maxPerDay, priority, recessPreference,
    requiresConsecutive, consecutiveBlock,
  }) {
    super(id);

    /** @type {string} */
    this.classId = String(classId ?? '');
    /** @type {string} */
    this.subjectId = String(subjectId ?? '');
    /** @type {string|null} */
    this.teacherId = teacherId || null;
    /** @type {number} */
    this.periodsPerWeek = Number(periodsPerWeek ?? 1);
    /** @type {number} */
    this.maxPerDay = Number(maxPerDay ?? 1);
    /** @type {string} */
    this.priority = priority ?? Priority.CORE;
    /** @type {string} */
    this.recessPreference = recessPreference ?? RecessSide.ANY;
    /** @type {boolean} */
    this.requiresConsecutive = Boolean(requiresConsecutive);
    /** @type {number} */
    this.consecutiveBlock = this.requiresConsecutive ? Math.max(2, Number(consecutiveBlock ?? 2)) : 1;
  }

  /** @returns {number} Higher schedules earlier. */
  get priorityRank() {
    return PRIORITY_RANK[this.priority] ?? 1;
  }

  /** @returns {boolean} */
  get isCore() {
    return this.priority === Priority.CORE;
  }

  /**
   * How many separate placements the scheduler must make.
   * A 4-period/week subject in blocks of 2 is two placements, not four.
   * @returns {number}
   */
  get blockCount() {
    return Math.ceil(this.periodsPerWeek / this.consecutiveBlock);
  }

  /**
   * Periods left over when periodsPerWeek is not a whole multiple of the block
   * size — e.g. 5 periods in blocks of 2 leaves one single period.
   * @returns {number}
   */
  get remainderPeriods() {
    return this.periodsPerWeek % this.consecutiveBlock;
  }

  /** @returns {string} Composite key preventing duplicate class+subject rows. */
  get uniquenessKey() {
    return `${this.classId}::${this.subjectId}`;
  }

  /** @returns {string} */
  get displayName() {
    return `${this.classId} · ${this.subjectId}`;
  }

  /** @returns {Result} */
  validate() {
    const errors = [];
    const warnings = [];

    if (!this.classId) errors.push('A class must be selected.');
    if (!this.subjectId) errors.push('A subject must be selected.');

    if (!Number.isInteger(this.periodsPerWeek) || this.periodsPerWeek < 1) {
      errors.push('Periods per week must be a whole number of at least 1.');
    }
    if (!Number.isInteger(this.maxPerDay) || this.maxPerDay < 1) {
      errors.push('Maximum periods per day must be a whole number of at least 1.');
    }
    if (this.maxPerDay > this.periodsPerWeek) {
      warnings.push('The daily cap is higher than the weekly total, so it will never apply.');
    }
    if (this.requiresConsecutive && this.consecutiveBlock > this.periodsPerWeek) {
      errors.push(`A block of ${this.consecutiveBlock} periods cannot fit into ${this.periodsPerWeek} periods per week.`);
    }
    if (this.requiresConsecutive && this.consecutiveBlock > this.maxPerDay) {
      errors.push(`A block of ${this.consecutiveBlock} consecutive periods needs a daily cap of at least ${this.consecutiveBlock}.`);
    }
    if (!Object.values(Priority).includes(this.priority)) {
      errors.push(`Unknown priority "${this.priority}".`);
    }
    if (!Object.values(RecessSide).includes(this.recessPreference)) {
      errors.push(`Unknown recess preference "${this.recessPreference}".`);
    }

    return errors.length > 0 ? Result.fail(errors, warnings) : Result.ok(this, warnings);
  }

  /** @returns {object} */
  toJSON() {
    return {
      id: this.id,
      classId: this.classId,
      subjectId: this.subjectId,
      teacherId: this.teacherId,
      periodsPerWeek: this.periodsPerWeek,
      maxPerDay: this.maxPerDay,
      priority: this.priority,
      recessPreference: this.recessPreference,
      requiresConsecutive: this.requiresConsecutive,
      consecutiveBlock: this.consecutiveBlock,
    };
  }
}
