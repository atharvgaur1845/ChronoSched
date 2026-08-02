/**
 * @file LessonDemand.js
 * @description One atomic unit of work for the scheduler: "place N consecutive
 * periods of this subject for this class, somewhere".
 *
 * WHY THIS EXISTS RATHER THAN SCHEDULING CurriculumEntry DIRECTLY
 * A curriculum row says "Physics Lab, 4 periods a week, in blocks of 2". The
 * solver cannot place "4 periods"; it places two independent 2-period blocks.
 * Expanding rows into demands up front means the solver's inner loop deals with
 * one uniform concept and never has to re-derive block arithmetic.
 */

import { Priority, RecessSide, Spread } from '../utils/Constants.js';

export class LessonDemand {
  /**
   * @param {object} data
   * @param {string} data.id            Unique within one solve.
   * @param {string} data.curriculumId  Row this demand came from.
   * @param {string} data.classId
   * @param {string} data.subjectId
   * @param {string|null} data.fixedTeacherId Non-null pins the teacher.
   * @param {number} data.size          Consecutive periods to place (1 = single).
   * @param {string} data.priority
   * @param {number} data.priorityRank
   * @param {string} data.recessPreference
   * @param {string} [data.spread]      One of {@link Spread}.
   * @param {number} [data.periodsPerWeek] Total for the row, used to derive
   *        the ideal gap between occurrences.
   * @param {number} data.difficulty    1–5, from the Subject.
   * @param {number} data.maxPerDay
   * @param {boolean} data.isLab
   * @param {string|null} data.blockId  Shared by the periods of one block.
   */
  constructor({
    id, curriculumId, classId, subjectId, fixedTeacherId, size,
    priority, priorityRank, recessPreference, spread, periodsPerWeek,
    difficulty, maxPerDay, isLab, blockId,
  }) {
    /** @type {string} */ this.id = id;
    /** @type {string} */ this.curriculumId = curriculumId;
    /** @type {string} */ this.classId = classId;
    /** @type {string} */ this.subjectId = subjectId;
    /** @type {string|null} */ this.fixedTeacherId = fixedTeacherId ?? null;
    /** @type {number} */ this.size = size;
    /** @type {string} */ this.priority = priority ?? Priority.CORE;
    /** @type {number} */ this.priorityRank = priorityRank ?? 1;
    /** @type {string} */ this.recessPreference = recessPreference ?? RecessSide.ANY;
    /** @type {string} */ this.spread = spread ?? Spread.SPREAD_OUT;
    /** @type {number} */ this.periodsPerWeek = periodsPerWeek ?? size;
    /** @type {number} */ this.difficulty = difficulty ?? 3;
    /** @type {number} */ this.maxPerDay = maxPerDay ?? 1;
    /** @type {boolean} */ this.isLab = Boolean(isLab);
    /** @type {string|null} */ this.blockId = blockId ?? null;

    Object.freeze(this);
  }

  /** @returns {boolean} True when this must occupy back-to-back periods. */
  get isBlock() {
    return this.size > 1;
  }

  /** @returns {boolean} */
  get isCore() {
    return this.priority === Priority.CORE;
  }

  /** @returns {boolean} True when the recess side matters. */
  get hasRecessPreference() {
    return this.recessPreference !== RecessSide.ANY;
  }

  /** @returns {string} Debug label. */
  toString() {
    return `${this.classId}/${this.subjectId}×${this.size}`;
  }
}
