/**
 * @file TimeSlot.js
 * @description One teaching period on one day — the atomic unit of the grid.
 *
 * Slots are DERIVED from Settings by {@link TimeGrid}, never hand-authored and
 * never persisted. Storing them would mean two sources of truth for the school
 * day; changing the start time would leave stale slots behind in LocalStorage.
 * Lessons therefore reference a slot by its deterministic id (`d0p3`), which
 * stays valid as long as the grid geometry does.
 */

import { formatRange } from '../utils/TimeUtils.js';
import { SlotKind } from '../utils/Constants.js';

export class TimeSlot {
  /**
   * @param {object} data
   * @param {number} data.dayIndex       0-based index into Settings.workingDays.
   * @param {number} data.periodIndex    0-based teaching period index.
   * @param {string} data.dayLabel       e.g. "Mon".
   * @param {string} data.startTime      "HH:MM"
   * @param {string} data.endTime        "HH:MM"
   * @param {boolean} data.isBeforeRecess
   */
  constructor({ dayIndex, periodIndex, dayLabel, startTime, endTime, isBeforeRecess }) {
    /** @type {string} Deterministic id, e.g. "d0p3". */
    this.id = TimeSlot.makeId(dayIndex, periodIndex);
    /** @type {number} */
    this.dayIndex = dayIndex;
    /** @type {number} */
    this.periodIndex = periodIndex;
    /** @type {string} */
    this.dayLabel = dayLabel;
    /** @type {string} */
    this.startTime = startTime;
    /** @type {string} */
    this.endTime = endTime;
    /** @type {boolean} */
    this.isBeforeRecess = isBeforeRecess;
    /** @type {string} */
    this.kind = SlotKind.TEACHING;

    Object.freeze(this);
  }

  /**
   * Builds the canonical slot id. Kept as a static so callers can compute an id
   * without holding a TimeSlot instance.
   * @param {number} dayIndex
   * @param {number} periodIndex
   * @returns {string}
   */
  static makeId(dayIndex, periodIndex) {
    return `d${dayIndex}p${periodIndex}`;
  }

  /** @returns {number} 1-based period number, as shown to users. */
  get periodNumber() {
    return this.periodIndex + 1;
  }

  /** @returns {string} e.g. "Mon P3". */
  get shortLabel() {
    return `${this.dayLabel} P${this.periodNumber}`;
  }

  /** @returns {string} e.g. "Mon, period 3 (09:40 – 10:20)". */
  get displayName() {
    return `${this.dayLabel}, period ${this.periodNumber} (${formatRange(this.startTime, this.endTime)})`;
  }

  /**
   * True when `other` is the period immediately following this one on the same
   * day with no break in between. Used to build consecutive lab blocks.
   * @param {TimeSlot} other
   * @returns {boolean}
   */
  isAdjacentTo(other) {
    return other.dayIndex === this.dayIndex
      && other.periodIndex === this.periodIndex + 1
      && other.isBeforeRecess === this.isBeforeRecess;
  }
}
