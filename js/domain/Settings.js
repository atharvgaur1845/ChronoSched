/**
 * @file Settings.js
 * @description School-wide configuration: working days, period timings, breaks,
 * the core-subject window and constraint weights.
 *
 * Settings is the input to {@link TimeGrid}, which means a change here
 * invalidates every generated timetable. That is why Timetable records a
 * `settingsHash` — so the UI can warn "this version was generated under
 * different timings" instead of silently showing a wrong grid.
 */

import { Result } from '../core/Result.js';
import { isValidTime, addMinutes } from '../utils/TimeUtils.js';
import {
  DEFAULT_SETTINGS,
  DEFAULT_CONSTRAINT_WEIGHTS,
  LIMITS,
  SCHEMA_VERSION,
} from '../utils/Constants.js';

/**
 * @typedef {object} BreakDefinition
 * @property {number} afterPeriod    1-based period number this break follows.
 * @property {string} label          Display name, e.g. "Recess".
 * @property {number} durationMinutes
 * @property {boolean} isRecess      Only one break should be the recess; it is
 *                                   the boundary for before/after preferences.
 */

export class Settings {
  /**
   * @param {object} [data] Plain object, typically straight from JSON.
   */
  constructor(data = {}) {
    const merged = { ...DEFAULT_SETTINGS, ...data };

    /** @type {number} */
    this.schemaVersion = merged.schemaVersion ?? SCHEMA_VERSION;

    /** @type {{name: string, academicYear: string}} */
    this.school = { ...DEFAULT_SETTINGS.school, ...(merged.school ?? {}) };

    /** @type {string[]} Ordered day labels; array length defines the week. */
    this.workingDays = [...(merged.workingDays ?? DEFAULT_SETTINGS.workingDays)];

    /** @type {string} "HH:MM" when period 1 begins. */
    this.dayStart = merged.dayStart ?? DEFAULT_SETTINGS.dayStart;

    /** @type {number} Length of a single teaching period. */
    this.periodDurationMinutes = Number(merged.periodDurationMinutes) || DEFAULT_SETTINGS.periodDurationMinutes;

    /** @type {number} Teaching periods per day, excluding breaks. */
    this.periodCount = Number(merged.periodCount) || DEFAULT_SETTINGS.periodCount;

    /** @type {BreakDefinition[]} */
    this.breaks = (merged.breaks ?? DEFAULT_SETTINGS.breaks).map((item) => ({
      afterPeriod: Number(item.afterPeriod),
      label: String(item.label ?? 'Break'),
      durationMinutes: Number(item.durationMinutes) || 0,
      isRecess: Boolean(item.isRecess),
    }));

    /**
     * @type {{from: number, to: number}}
     * Window (1-based, inclusive) in which CORE subjects are preferred.
     * Configurable rather than hard-coded to 1–6 so a 7-period or 10-period
     * school is not silently mis-scheduled.
     */
    this.corePeriodWindow = {
      from: Number(merged.corePeriodWindow?.from ?? DEFAULT_SETTINGS.corePeriodWindow.from),
      to: Number(merged.corePeriodWindow?.to ?? DEFAULT_SETTINGS.corePeriodWindow.to),
    };

    /** @type {Record<string, number>} Soft-constraint weights, admin-tunable. */
    this.constraintWeights = { ...DEFAULT_CONSTRAINT_WEIGHTS, ...(merged.constraintWeights ?? {}) };
  }

  /** @returns {number} Number of working days in the week. */
  get dayCount() {
    return this.workingDays.length;
  }

  /** @returns {number} Total teaching slots available to one class per week. */
  get weeklyCapacityPerClass() {
    return this.dayCount * this.periodCount;
  }

  /**
   * The break that acts as the recess boundary, if any.
   * @returns {BreakDefinition|null}
   */
  get recess() {
    return this.breaks.find((item) => item.isRecess) ?? null;
  }

  /**
   * Approximate end of the teaching day, used for display only.
   * @returns {string} "HH:MM"
   */
  get dayEnd() {
    const teaching = this.periodCount * this.periodDurationMinutes;
    const breaks = this.breaks.reduce((total, item) => total + item.durationMinutes, 0);
    return addMinutes(this.dayStart, teaching + breaks);
  }

  /**
   * A short fingerprint of every field that affects slot geometry.
   * Timetables record it so the UI can detect stale versions.
   * @returns {string}
   */
  get geometryHash() {
    const parts = [
      this.workingDays.join(','),
      this.dayStart,
      this.periodDurationMinutes,
      this.periodCount,
      this.breaks.map((b) => `${b.afterPeriod}/${b.durationMinutes}/${b.isRecess ? 'r' : 'b'}`).join('|'),
    ];
    return parts.join('~');
  }

  /**
   * Validates the configuration's internal consistency.
   * @returns {Result}
   */
  validate() {
    const errors = [];
    const warnings = [];

    if (this.workingDays.length === 0) errors.push('At least one working day is required.');
    if (!isValidTime(this.dayStart)) errors.push(`Day start "${this.dayStart}" is not a valid HH:MM time.`);
    if (this.periodDurationMinutes < 5) errors.push('Period duration must be at least 5 minutes.');

    if (this.periodCount < LIMITS.MIN_PERIODS || this.periodCount > LIMITS.MAX_PERIODS) {
      errors.push(`Periods per day must be between ${LIMITS.MIN_PERIODS} and ${LIMITS.MAX_PERIODS}.`);
    }

    for (const item of this.breaks) {
      if (item.afterPeriod < 1 || item.afterPeriod >= this.periodCount) {
        errors.push(`Break "${item.label}" is set after period ${item.afterPeriod}, which is outside 1–${this.periodCount - 1}.`);
      }
      if (item.durationMinutes <= 0) errors.push(`Break "${item.label}" must last at least 1 minute.`);
    }

    if (this.breaks.filter((item) => item.isRecess).length > 1) {
      errors.push('Only one break can be marked as the recess.');
    }
    if (this.recess === null) {
      warnings.push('No break is marked as the recess, so "before/after recess" subject preferences will be ignored.');
    }

    const { from, to } = this.corePeriodWindow;
    if (from < 1 || to > this.periodCount || from > to) {
      errors.push(`Core subject window ${from}–${to} must fall inside 1–${this.periodCount}.`);
    }

    return errors.length > 0 ? Result.fail(errors, warnings) : Result.ok(this, warnings);
  }

  /** @returns {object} */
  toJSON() {
    return {
      schemaVersion: this.schemaVersion,
      school: { ...this.school },
      workingDays: [...this.workingDays],
      dayStart: this.dayStart,
      periodDurationMinutes: this.periodDurationMinutes,
      periodCount: this.periodCount,
      breaks: this.breaks.map((item) => ({ ...item })),
      corePeriodWindow: { ...this.corePeriodWindow },
      constraintWeights: { ...this.constraintWeights },
    };
  }

  /**
   * @param {object} changes
   * @returns {Settings}
   */
  withChanges(changes) {
    return new Settings({ ...this.toJSON(), ...changes });
  }
}
