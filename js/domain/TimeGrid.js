/**
 * @file TimeGrid.js
 * @description Turns {@link Settings} into the concrete week of {@link TimeSlot}s,
 * plus the lookup structures the scheduler and the renderer both need.
 *
 * This is the single place that knows how a school day is laid out. Period
 * times, recess placement and "which periods are back-to-back" are computed
 * once here; nothing else in the codebase performs time arithmetic on the grid.
 */

import { TimeSlot } from './TimeSlot.js';
import { addMinutes } from '../utils/TimeUtils.js';
import { SlotKind } from '../utils/Constants.js';

/**
 * @typedef {object} TimelineEntry
 * @property {'period'|'break'} type
 * @property {string} startTime
 * @property {string} endTime
 * @property {number} [periodIndex] Present when type is 'period'.
 * @property {string} [label]       Present when type is 'break'.
 * @property {boolean} [isRecess]   Present when type is 'break'.
 */

export class TimeGrid {
  /**
   * @private Use {@link TimeGrid.build}.
   * @param {object} parts
   */
  constructor({ days, timeline, slots, byId, byDay, runs, settingsHash }) {
    /** @type {Array<{index: number, label: string}>} */
    this.days = days;
    /** @type {TimelineEntry[]} One day's shape; identical for every day. */
    this.timeline = timeline;
    /** @type {TimeSlot[]} Every teaching slot in the week, day-major order. */
    this.slots = slots;
    /** @private @type {Map<string, TimeSlot>} */
    this._byId = byId;
    /** @private @type {TimeSlot[][]} Indexed by dayIndex. */
    this._byDay = byDay;
    /** @private @type {TimeSlot[][][]} runs[dayIndex] = array of contiguous slot runs. */
    this._runs = runs;
    /** @type {string} Geometry fingerprint of the settings that produced this. */
    this.settingsHash = settingsHash;

    Object.freeze(this);
  }

  /**
   * Builds a grid from settings.
   *
   * Period times accumulate left to right: each period advances the clock by
   * the period duration, and any break declared after that period advances it
   * further. That single pass is what keeps displayed times and scheduling
   * geometry in sync.
   *
   * @param {import('./Settings.js').Settings} settings
   * @returns {TimeGrid}
   */
  static build(settings) {
    const recessAfterPeriod = settings.recess?.afterPeriod ?? Number.POSITIVE_INFINITY;
    const breaksByPeriod = new Map(settings.breaks.map((item) => [item.afterPeriod, item]));

    /** @type {TimelineEntry[]} */
    const timeline = [];
    /** @type {Array<{index: number, start: string, end: string, isBeforeRecess: boolean}>} */
    const periodShape = [];

    let clock = settings.dayStart;
    for (let periodIndex = 0; periodIndex < settings.periodCount; periodIndex += 1) {
      const start = clock;
      const end = addMinutes(start, settings.periodDurationMinutes);
      const periodNumber = periodIndex + 1;

      periodShape.push({
        index: periodIndex,
        start,
        end,
        isBeforeRecess: periodNumber <= recessAfterPeriod,
      });
      timeline.push({ type: 'period', periodIndex, startTime: start, endTime: end });
      clock = end;

      const breakDef = breaksByPeriod.get(periodNumber);
      if (breakDef) {
        const breakEnd = addMinutes(clock, breakDef.durationMinutes);
        timeline.push({
          type: 'break',
          label: breakDef.label,
          isRecess: breakDef.isRecess,
          startTime: clock,
          endTime: breakEnd,
        });
        clock = breakEnd;
      }
    }

    const days = settings.workingDays.map((label, index) => ({ index, label }));

    /** @type {TimeSlot[]} */
    const slots = [];
    /** @type {TimeSlot[][]} */
    const byDay = [];
    for (const day of days) {
      const daySlots = periodShape.map((shape) => new TimeSlot({
        dayIndex: day.index,
        periodIndex: shape.index,
        dayLabel: day.label,
        startTime: shape.start,
        endTime: shape.end,
        isBeforeRecess: shape.isBeforeRecess,
      }));
      byDay.push(daySlots);
      slots.push(...daySlots);
    }

    const byId = new Map(slots.map((slot) => [slot.id, slot]));
    const runs = byDay.map((daySlots) => TimeGrid._computeRuns(daySlots, breaksByPeriod));

    return new TimeGrid({
      days, timeline, slots, byId, byDay, runs,
      settingsHash: settings.geometryHash,
    });
  }

  /**
   * Splits a day's slots into maximal runs uninterrupted by a break.
   *
   * A consecutive lab block must fit inside one run — periods 4 and 5 are not
   * genuinely back-to-back if recess sits between them, and scheduling a double
   * lab across the break is exactly the bug this prevents.
   *
   * @private
   * @param {TimeSlot[]} daySlots
   * @param {Map<number, object>} breaksByPeriod
   * @returns {TimeSlot[][]}
   */
  static _computeRuns(daySlots, breaksByPeriod) {
    const runs = [];
    let current = [];

    for (const slot of daySlots) {
      current.push(slot);
      if (breaksByPeriod.has(slot.periodNumber)) {
        runs.push(current);
        current = [];
      }
    }
    if (current.length > 0) runs.push(current);
    return runs;
  }

  /** @returns {number} */
  get dayCount() { return this.days.length; }

  /** @returns {number} */
  get periodCount() { return this._byDay[0]?.length ?? 0; }

  /** @returns {number} Total teaching slots in the week. */
  get slotCount() { return this.slots.length; }

  /**
   * @param {string} slotId
   * @returns {TimeSlot|undefined}
   */
  getSlot(slotId) {
    return this._byId.get(slotId);
  }

  /**
   * @param {number} dayIndex
   * @param {number} periodIndex
   * @returns {TimeSlot|undefined}
   */
  getSlotAt(dayIndex, periodIndex) {
    return this._byDay[dayIndex]?.[periodIndex];
  }

  /**
   * @param {number} dayIndex
   * @returns {TimeSlot[]}
   */
  slotsForDay(dayIndex) {
    return this._byDay[dayIndex] ?? [];
  }

  /**
   * Every run of `length` consecutive slots available anywhere in the week.
   * The scheduler asks for this once per block size rather than recomputing
   * adjacency for every candidate placement.
   *
   * @param {number} length Number of consecutive periods required.
   * @returns {TimeSlot[][]} Each entry is an array of exactly `length` slots.
   */
  consecutiveWindows(length) {
    if (length <= 1) return this.slots.map((slot) => [slot]);

    const windows = [];
    for (const dayRuns of this._runs) {
      for (const run of dayRuns) {
        for (let start = 0; start + length <= run.length; start += 1) {
          windows.push(run.slice(start, start + length));
        }
      }
    }
    return windows;
  }

  /**
   * Renderer helper: the day's shape with break rows interleaved.
   * @returns {TimelineEntry[]}
   */
  getTimeline() {
    return this.timeline;
  }

  /**
   * True when the grid can physically hold the requested number of periods for
   * one class. Used by the pre-generation health check.
   * @param {number} requiredPeriods
   * @returns {boolean}
   */
  canFit(requiredPeriods) {
    return requiredPeriods <= this.slotCount;
  }

  /** @returns {string} Debug representation. */
  toString() {
    return `TimeGrid(${this.dayCount} days × ${this.periodCount} periods = ${this.slotCount} slots)`;
  }
}

export { SlotKind };
