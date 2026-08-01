/**
 * @file Scheduler.js
 * @description Facade over the whole generation pipeline.
 *
 * Everything outside this package talks to exactly one method:
 *     scheduler.generate(schoolData, options) → Timetable
 *
 * That is the entire public surface of a subsystem containing two strategies,
 * thirteen constraints, an expander, an optimiser and a reporter. The UI cannot
 * accidentally depend on how any of it works, and the algorithm can be replaced
 * wholesale without a single view changing.
 *
 * THE PIPELINE
 *   Settings ──▶ TimeGrid ──▶ SchedulingContext   (immutable inputs, precomputed)
 *   Curriculum ─▶ CurriculumExpander ─▶ demands ─▶ ordered hardest-first
 *   Locked lessons ─▶ seeded into ScheduleState, their demand subtracted
 *   demands ─▶ ISchedulingStrategy ─▶ ScheduleState
 *   ScheduleState ─▶ LocalSearchOptimizer (optional)
 *   ScheduleState ─▶ SchedulingReport ─▶ Timetable (new version)
 *
 * The scheduler has no reference to the DOM, storage or the event bus. It is a
 * pure function of its inputs apart from the seeded RNG, which exists so that
 * pressing Generate twice yields genuinely different versions to compare.
 */

import { SchedulingContext } from './SchedulingContext.js';
import { ScheduleState } from './ScheduleState.js';
import { CurriculumExpander } from './CurriculumExpander.js';
import { SchedulingReport } from './SchedulingReport.js';
import { Timetable } from '../domain/Timetable.js';
import { StrategyId } from '../utils/Constants.js';
import { createLogger } from '../utils/Logger.js';

const log = createLogger('Scheduler');

/**
 * Small deterministic PRNG (mulberry32).
 *
 * `Math.random()` would make every run unreproducible, so a failing timetable
 * could never be investigated. A seeded generator gives both properties that
 * matter: different output each time by default, identical output on demand.
 *
 * @param {number} seed
 * @returns {() => number} Values in [0, 1).
 */
function createRandom(seed) {
  let state = seed >>> 0;
  return function next() {
    state = (state + 0x6D2B79F5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export class Scheduler {
  /**
   * @param {object} deps
   * @param {import('./constraints/ConstraintRegistry.js').ConstraintRegistry} deps.registry
   * @param {import('./strategies/ISchedulingStrategy.js').ISchedulingStrategy[]} deps.strategies
   * @param {import('./strategies/LocalSearchOptimizer.js').LocalSearchOptimizer} [deps.optimizer]
   */
  constructor({ registry, strategies, optimizer }) {
    /** @private */ this._registry = registry;
    /** @private */ this._optimizer = optimizer ?? null;
    /** @private */ this._expander = new CurriculumExpander();

    /** @private @type {Map<string, import('./strategies/ISchedulingStrategy.js').ISchedulingStrategy>} */
    this._strategies = new Map(strategies.map((strategy) => [strategy.id, strategy]));

    if (this._strategies.size === 0) {
      throw new Error('Scheduler requires at least one strategy.');
    }
  }

  /**
   * Strategies available to the Generate screen.
   * @returns {Array<{id: string, displayName: string, description: string}>}
   */
  get availableStrategies() {
    return [...this._strategies.values()].map((strategy) => ({
      id: strategy.id,
      displayName: strategy.displayName,
      description: strategy.description,
    }));
  }

  /** @returns {import('./constraints/ConstraintRegistry.js').ConstraintRegistry} */
  get registry() {
    return this._registry;
  }

  /**
   * Builds a scheduling context for the current data. Exposed so that
   * ValidationService can check manual edits against the very same rules the
   * generator used, rather than a second, divergent implementation.
   *
   * @param {import('../domain/SchoolData.js').SchoolData} schoolData
   * @returns {SchedulingContext}
   */
  createContext(schoolData) {
    return new SchedulingContext({
      schoolData,
      timeGrid: schoolData.timeGrid,
      settings: schoolData.settings,
    });
  }

  /**
   * Generates a new timetable version.
   *
   * @param {import('../domain/SchoolData.js').SchoolData} schoolData
   * @param {object} [options]
   * @param {string} [options.strategyId]   Defaults to the thorough strategy.
   * @param {number} [options.seed]         Fix to reproduce a run exactly.
   * @param {boolean} [options.optimize]    Run the local-search pass afterwards.
   * @param {import('../domain/Timetable.js').Timetable|null} [options.basedOn]
   *        Existing version whose LOCKED lessons should be carried over.
   * @param {string} [options.label]
   * @returns {Timetable} Always returned — an unsolvable school produces a
   *          partial timetable with a report, never an exception.
   */
  generate(schoolData, {
    strategyId = StrategyId.BACKTRACKING,
    seed = Date.now(),
    optimize = true,
    basedOn = null,
    label = '',
  } = {}) {
    const startedAt = performance.now();

    const strategy = this._strategies.get(strategyId) ?? this._strategies.get(StrategyId.BACKTRACKING)
      ?? [...this._strategies.values()][0];

    const context = this.createContext(schoolData);
    const state = new ScheduleState(schoolData.timeGrid);
    const random = createRandom(seed);
    const warnings = [];

    // ---- Carry over pinned manual edits -----------------------------------
    const alreadyPlaced = this._seedLockedLessons(basedOn, state, context, warnings);

    // ---- Expand and order --------------------------------------------------
    const rawDemands = this._expander.expand(schoolData, { alreadyPlaced });
    const demands = this._expander.order(rawDemands, context);

    // Representative demand per class+subject, needed by the optimiser and the
    // report to re-score a lesson without re-deriving its curriculum row.
    const demandByPair = new Map();
    for (const demand of rawDemands) {
      const key = `${demand.classId}|${demand.subjectId}`;
      if (!demandByPair.has(key)) demandByPair.set(key, demand);
    }

    log.info(`Generating with "${strategy.id}": ${demands.length} placements for `
      + `${schoolData.counts.classes} classes across ${schoolData.timeGrid.slotCount} slots.`);

    // ---- Solve -------------------------------------------------------------
    const outcome = strategy.solve({ demands, state, context, registry: this._registry, random });

    // ---- Improve -----------------------------------------------------------
    if (optimize && this._optimizer) {
      const improvement = this._optimizer.optimize({
        state, context, registry: this._registry, demandByPair,
      });
      if (improvement.relocations > 0) {
        log.debug(`Optimiser moved ${improvement.relocations} periods.`);
      }
    }

    // ---- Report ------------------------------------------------------------
    const report = new SchedulingReport({
      state,
      context,
      registry: this._registry,
      demandByPair,
      diagnose: (demand) => strategy._diagnose(demand, state, context, this._registry),
      strategyId: strategy.id,
      durationMs: performance.now() - startedAt,
      nodesExplored: outcome.nodesExplored,
      budgetExhausted: outcome.budgetExhausted,
      warnings,
    });

    log.info(`Done in ${report.durationMs}ms — ${report.placedPeriods}/${report.requiredPeriods} periods placed `
      + `(${report.fillPercent}%), quality penalty ${report.softScore}.`);

    // Version number is assigned by TimetableRepository, which owns the
    // append-only guarantee. Passing 0 here would be a lie, so it passes the
    // repository's next number as a placeholder the repository overwrites.
    return new Timetable({
      version: schoolData.nextVersionNumber,
      label: label || `Version ${schoolData.nextVersionNumber}`,
      strategyId: strategy.id,
      settingsHash: schoolData.settings.geometryHash,
      lessons: state.lessons.map((lesson) => lesson.toJSON()),
      report: report.toJSON(),
    });
  }

  /**
   * Copies locked lessons from a previous version into the fresh state and
   * reports how many periods of each curriculum row they already satisfy.
   *
   * This is what makes "pin the three fixtures I care about, then regenerate"
   * work — the solver treats those cells as immovable and schedules around them.
   *
   * @private
   * @param {import('../domain/Timetable.js').Timetable|null} basedOn
   * @param {ScheduleState} state
   * @param {SchedulingContext} context
   * @param {string[]} warnings
   * @returns {Map<string, number>} curriculumId → periods already fixed.
   */
  _seedLockedLessons(basedOn, state, context, warnings) {
    /** @type {Map<string, number>} */
    const alreadyPlaced = new Map();
    if (!basedOn) return alreadyPlaced;

    /** @type {Map<string, string>} `classId|subjectId` → curriculumId */
    const rowByPair = new Map();
    for (const entry of context.schoolData.curriculum) {
      rowByPair.set(`${entry.classId}|${entry.subjectId}`, entry.id);
    }

    let carried = 0;
    let dropped = 0;

    for (const lesson of basedOn.lessons) {
      if (!lesson.locked) continue;

      const slot = context.timeGrid.getSlot(lesson.slotId);
      if (!slot) { dropped += 1; continue; }

      const subject = context.subject(lesson.subjectId);
      state.seedLesson(lesson, subject?.difficulty ?? 3);
      carried += 1;

      const curriculumId = rowByPair.get(`${lesson.classId}|${lesson.subjectId}`);
      if (curriculumId) {
        alreadyPlaced.set(curriculumId, (alreadyPlaced.get(curriculumId) ?? 0) + 1);
      }
    }

    if (carried > 0) warnings.push(`${carried} pinned period(s) were kept from the previous version.`);
    if (dropped > 0) warnings.push(`${dropped} pinned period(s) were dropped because their time slot no longer exists.`);

    return alreadyPlaced;
  }
}
