/**
 * @file SchedulingReport.js
 * @description Measures a finished timetable and explains what it could not do.
 *
 * WHY A GENERATOR MUST REPORT, NOT JUST PRODUCE
 * A timetable that quietly drops four Physics periods looks fine on screen and
 * is discovered in week two of term. Every shortfall is therefore surfaced with
 * the class, the subject, how many periods are missing and the most common
 * reason — turning an invisible data problem into a fixable one.
 *
 * The report is stored on the Timetable, so a version generated last month can
 * still be inspected without regenerating it.
 */

import { sortBy } from '../utils/ArrayUtils.js';

/**
 * @typedef {object} Shortfall
 * @property {string} classId
 * @property {string} className
 * @property {string} subjectId
 * @property {string} subjectName
 * @property {number} required
 * @property {number} placed
 * @property {number} missing
 * @property {string} reason
 */

export class SchedulingReport {
  /**
   * Builds the report by comparing what the curriculum asked for against what
   * ended up in the grid.
   *
   * @param {object} input
   * @param {import('./ScheduleState.js').ScheduleState} input.state
   * @param {import('./SchedulingContext.js').SchedulingContext} input.context
   * @param {import('./constraints/ConstraintRegistry.js').ConstraintRegistry} input.registry
   * @param {Map<string, import('./LessonDemand.js').LessonDemand>} input.demandByPair
   *        `classId|subjectId` → a representative demand, used to re-score lessons.
   * @param {(demand: import('./LessonDemand.js').LessonDemand) => string} input.diagnose
   * @param {string} input.strategyId
   * @param {number} input.durationMs
   * @param {number} input.nodesExplored
   * @param {boolean} input.budgetExhausted
   * @param {string[]} [input.warnings]
   */
  constructor({
    state, context, registry, demandByPair, diagnose,
    strategyId, durationMs, nodesExplored, budgetExhausted, warnings = [],
  }) {
    /** @type {string} */ this.strategyId = strategyId;
    /** @type {string} */ this.generatedAt = new Date().toISOString();
    /** @type {number} */ this.durationMs = Math.round(durationMs);
    /** @type {number} */ this.nodesExplored = nodesExplored;
    /** @type {boolean} */ this.budgetExhausted = budgetExhausted;
    /** @type {string[]} */ this.warnings = [...warnings];

    const { shortfalls, required, placed } = SchedulingReport._measureCoverage(state, context, diagnose, demandByPair);

    /** @type {Shortfall[]} */ this.shortfalls = shortfalls;
    /** @type {number} */ this.requiredPeriods = required;
    /** @type {number} */ this.placedPeriods = placed;
    /** @type {number} */ this.missingPeriods = required - placed;
    /** @type {number} */ this.fillRate = required === 0 ? 1 : placed / required;

    const quality = SchedulingReport._scoreQuality(state, context, registry, demandByPair);
    /** @type {number} */ this.softScore = quality.total;
    /** @type {Record<string, number>} */ this.softBreakdown = quality.breakdown;

    /** @type {Array<object>} */ this.teacherLoads = SchedulingReport._teacherLoads(state, context);
    /** @type {number} */ this.unstaffedPeriods = state.lessons.filter((lesson) => !lesson.teacherId).length;

    if (this.budgetExhausted) {
      this.warnings.push('The search limit was reached, so the last part of the timetable was filled quickly rather than thoroughly. Try the thorough strategy again, or relax a constraint.');
    }
    if (this.unstaffedPeriods > 0) {
      this.warnings.push(`${this.unstaffedPeriods} period(s) have no teacher assigned. Check that a qualified teacher exists for every subject.`);
    }
  }

  /**
   * Compares curriculum requirements against the grid, per class and subject.
   * @private
   */
  static _measureCoverage(state, context, diagnose, demandByPair) {
    /** @type {Map<string, number>} `classId|subjectId` → periods in the grid */
    const actual = new Map();
    for (const lesson of state.lessons) {
      const key = `${lesson.classId}|${lesson.subjectId}`;
      actual.set(key, (actual.get(key) ?? 0) + 1);
    }

    /** @type {Shortfall[]} */
    const shortfalls = [];
    let required = 0;
    let placed = 0;

    for (const entry of context.schoolData.curriculum) {
      const key = `${entry.classId}|${entry.subjectId}`;
      const got = actual.get(key) ?? 0;

      required += entry.periodsPerWeek;
      placed += Math.min(got, entry.periodsPerWeek);

      if (got >= entry.periodsPerWeek) continue;

      const demand = demandByPair.get(key);
      shortfalls.push({
        classId: entry.classId,
        className: context.schoolClass(entry.classId)?.name ?? entry.classId,
        subjectId: entry.subjectId,
        subjectName: context.subject(entry.subjectId)?.name ?? entry.subjectId,
        required: entry.periodsPerWeek,
        placed: got,
        missing: entry.periodsPerWeek - got,
        reason: demand ? diagnose(demand) : 'No demand was generated for this row.',
      });
    }

    return {
      shortfalls: sortBy(shortfalls, (item) => -item.missing, (item) => item.className),
      required,
      placed,
    };
  }

  /**
   * Total soft-constraint cost of the finished grid.
   *
   * Each lesson is temporarily lifted out before being scored, because a
   * placement evaluated against a state that still contains it would clash with
   * itself and report a nonsense figure.
   * @private
   */
  static _scoreQuality(state, context, registry, demandByPair) {
    /** @type {Record<string, number>} */
    const breakdown = {};
    let total = 0;

    for (const lesson of state.lessons) {
      const demand = demandByPair.get(`${lesson.classId}|${lesson.subjectId}`);
      const slot = context.timeGrid.getSlot(lesson.slotId);
      if (!demand || !slot) continue;

      const placement = { demand, slots: [slot], teacherId: lesson.teacherId };

      state.unplace(placement);
      const parts = registry.penaltyBreakdown(placement, state, context);
      state.place(placement);

      for (const [id, value] of parts) {
        breakdown[id] = (breakdown[id] ?? 0) + value;
        total += value;
      }
    }

    return { total: Math.round(total * 10) / 10, breakdown };
  }

  /**
   * Per-teacher workload and idle-period counts.
   * @private
   */
  static _teacherLoads(state, context) {
    const rows = [];
    for (const teacher of context.schoolData.teachers) {
      const periods = state.teacherWeekLoad(teacher.id);
      if (periods === 0) continue;

      let gaps = 0;
      let busiestDay = 0;
      for (const day of context.timeGrid.days) {
        gaps += state.teacherGapCount(teacher.id, day.index);
        busiestDay = Math.max(busiestDay, state.teacherDayLoad(teacher.id, day.index));
      }

      rows.push({
        teacherId: teacher.id,
        name: teacher.name,
        periods,
        capacity: teacher.maxPeriodsPerWeek,
        gaps,
        busiestDay,
        overloaded: periods > teacher.maxPeriodsPerWeek,
      });
    }
    return sortBy(rows, (row) => -row.periods);
  }

  /** @returns {boolean} True when every requested period found a home. */
  get isComplete() {
    return this.missingPeriods === 0;
  }

  /** @returns {number} Fill rate as a whole percentage. */
  get fillPercent() {
    return Math.round(this.fillRate * 100);
  }

  /**
   * Plain-object form stored inside the Timetable.
   * @returns {object}
   */
  toJSON() {
    return {
      strategyId: this.strategyId,
      generatedAt: this.generatedAt,
      durationMs: this.durationMs,
      nodesExplored: this.nodesExplored,
      budgetExhausted: this.budgetExhausted,
      requiredPeriods: this.requiredPeriods,
      placedPeriods: this.placedPeriods,
      missingPeriods: this.missingPeriods,
      fillRate: this.fillRate,
      softScore: this.softScore,
      softBreakdown: this.softBreakdown,
      shortfalls: this.shortfalls,
      teacherLoads: this.teacherLoads,
      unstaffedPeriods: this.unstaffedPeriods,
      warnings: this.warnings,
    };
  }
}
