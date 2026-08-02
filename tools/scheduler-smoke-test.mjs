/**
 * @file scheduler-smoke-test.mjs
 * @description Headless exercise of the scheduling engine against the seed data.
 *
 * The whole point of keeping `scheduling/` free of DOM, storage and event-bus
 * references is that it can run exactly like this — in Node, with no browser,
 * in milliseconds. If this file ever needs a DOM shim, a layering rule has been
 * broken.
 *
 * Run: npm run test:scheduler
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { SchoolData } from '../js/domain/SchoolData.js';
import { Scheduler } from '../js/scheduling/Scheduler.js';
import { createDefaultConstraintRegistry } from '../js/scheduling/constraints/DefaultConstraints.js';
import { GreedyHeuristicStrategy } from '../js/scheduling/strategies/GreedyHeuristicStrategy.js';
import { BacktrackingStrategy } from '../js/scheduling/strategies/BacktrackingStrategy.js';
import { LocalSearchOptimizer } from '../js/scheduling/strategies/LocalSearchOptimizer.js';
import { StrategyId } from '../js/utils/Constants.js';
import { setLogLevel, LogLevel } from '../js/utils/Logger.js';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, '..', 'data');

const readSeed = (name) => JSON.parse(readFileSync(join(dataDir, name), 'utf8')).data;

setLogLevel(LogLevel.WARN);

// ---------------------------------------------------------------- load data
const schoolData = new SchoolData();
schoolData.hydrate({
  settings: readSeed('settings.seed.json'),
  classes: readSeed('classes.seed.json'),
  subjects: readSeed('subjects.seed.json'),
  teachers: readSeed('teachers.seed.json'),
  curriculum: readSeed('curriculum.seed.json'),
});

console.log('ChronoSched — scheduler smoke test');
console.log('='.repeat(72));
console.log(`Grid      : ${schoolData.timeGrid}`);
console.log(`Data      : ${schoolData.counts.classes} classes, ${schoolData.counts.subjects} subjects, `
  + `${schoolData.counts.teachers} teachers, ${schoolData.counts.curriculum} curriculum rows`);
console.log(`Demand    : ${schoolData.counts.weeklyPeriods} periods/week`);
console.log('');

// ------------------------------------------------------------ build scheduler
const scheduler = new Scheduler({
  registry: createDefaultConstraintRegistry(),
  strategies: [new GreedyHeuristicStrategy(), new BacktrackingStrategy()],
  optimizer: new LocalSearchOptimizer(),
});

let failures = 0;
const check = (label, condition, detail = '') => {
  console.log(`  ${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!condition) failures += 1;
};

/**
 * Independently re-verifies the produced grid against the hard rules, without
 * using the scheduler's own indexes. A generator that marks its own homework is
 * worthless; this checks the actual output.
 */
function auditHardConstraints(timetable) {
  const grid = schoolData.timeGrid;
  const classSlot = new Set();
  const teacherSlot = new Set();
  const teacherDay = new Map();
  const teacherWeek = new Map();
  const subjectDay = new Map();
  const problems = [];

  for (const lesson of timetable.lessons) {
    const slot = grid.getSlot(lesson.slotId);
    if (!slot) { problems.push(`lesson in unknown slot ${lesson.slotId}`); continue; }

    const cKey = `${lesson.classId}|${lesson.slotId}`;
    if (classSlot.has(cKey)) problems.push(`class double-booked: ${cKey}`);
    classSlot.add(cKey);

    const entry = schoolData.curriculum.find(
      (e) => e.classId === lesson.classId && e.subjectId === lesson.subjectId,
    );
    const sdKey = `${lesson.classId}|${lesson.subjectId}|${slot.dayIndex}`;
    subjectDay.set(sdKey, (subjectDay.get(sdKey) ?? 0) + 1);
    if (entry && subjectDay.get(sdKey) > entry.maxPerDay) {
      problems.push(`subject daily cap exceeded: ${sdKey} (${subjectDay.get(sdKey)} > ${entry.maxPerDay})`);
    }

    if (!lesson.teacherId) continue;
    const teacher = schoolData.teachers.get(lesson.teacherId);

    const tKey = `${lesson.teacherId}|${lesson.slotId}`;
    if (teacherSlot.has(tKey)) problems.push(`teacher double-booked: ${tKey}`);
    teacherSlot.add(tKey);

    if (teacher && !teacher.isAvailableAt(slot.dayIndex, slot.periodIndex)) {
      problems.push(`${teacher.name} scheduled while unavailable at ${slot.shortLabel}`);
    }

    const tdKey = `${lesson.teacherId}|${slot.dayIndex}`;
    teacherDay.set(tdKey, (teacherDay.get(tdKey) ?? 0) + 1);
    if (teacher && teacherDay.get(tdKey) > teacher.maxPeriodsPerDay) {
      problems.push(`${teacher.name} over daily cap on day ${slot.dayIndex}`);
    }

    teacherWeek.set(lesson.teacherId, (teacherWeek.get(lesson.teacherId) ?? 0) + 1);
    if (teacher && teacherWeek.get(lesson.teacherId) > teacher.maxPeriodsPerWeek) {
      problems.push(`${teacher.name} over weekly cap`);
    }
  }

  // Consecutive blocks must remain contiguous within one day.
  const blocks = new Map();
  for (const lesson of timetable.lessons) {
    if (!lesson.blockId) continue;
    const list = blocks.get(lesson.blockId) ?? [];
    list.push(grid.getSlot(lesson.slotId));
    blocks.set(lesson.blockId, list);
  }
  for (const [blockId, slots] of blocks) {
    const sorted = slots.filter(Boolean).sort((a, b) => a.periodIndex - b.periodIndex);
    const sameDay = sorted.every((s) => s.dayIndex === sorted[0].dayIndex);
    const contiguous = sorted.every((s, i) => i === 0 || s.periodIndex === sorted[i - 1].periodIndex + 1);
    const unbroken = sorted.every((s) => s.isBeforeRecess === sorted[0].isBeforeRecess);
    if (!sameDay || !contiguous || !unbroken) problems.push(`block ${blockId} is not contiguous`);
  }

  return problems;
}

function run(strategyId, optimize) {
  const label = `${strategyId}${optimize ? ' + optimiser' : ''}`;
  console.log(`\n${label}`);
  console.log('-'.repeat(72));

  const started = performance.now();
  const timetable = scheduler.generate(schoolData, { strategyId, optimize, seed: 42 });
  const elapsed = performance.now() - started;
  const report = timetable.report;

  console.log(`  placed        ${report.placedPeriods}/${report.requiredPeriods} (${Math.round(report.fillRate * 100)}%)`);
  console.log(`  quality cost  ${report.softScore}`);
  console.log(`  unstaffed     ${report.unstaffedPeriods}`);
  console.log(`  time          ${elapsed.toFixed(0)}ms (${report.nodesExplored} nodes)`);

  if (report.shortfalls.length > 0) {
    console.log('  shortfalls:');
    for (const s of report.shortfalls.slice(0, 6)) {
      console.log(`    - ${s.className} / ${s.subjectName}: ${s.placed}/${s.required} — ${s.reason}`);
    }
  }

  const violations = auditHardConstraints(timetable);
  check('no hard-constraint violations', violations.length === 0, violations.slice(0, 4).join('; '));
  check('finishes under 5 seconds', elapsed < 5000, `${elapsed.toFixed(0)}ms`);

  return { timetable, report, elapsed };
}

const greedy = run(StrategyId.GREEDY, false);
const thorough = run(StrategyId.BACKTRACKING, false);
const optimised = run(StrategyId.BACKTRACKING, true);

console.log('\nCross-checks');
console.log('-'.repeat(72));
check('thorough places at least as many periods as greedy',
  thorough.report.placedPeriods >= greedy.report.placedPeriods,
  `${thorough.report.placedPeriods} vs ${greedy.report.placedPeriods}`);
check('optimiser does not reduce coverage',
  optimised.report.placedPeriods >= thorough.report.placedPeriods);
check('optimiser does not worsen quality',
  optimised.report.softScore <= thorough.report.softScore + 0.01,
  `${optimised.report.softScore} vs ${thorough.report.softScore}`);
check('seed 42 is reproducible', (() => {
  const a = scheduler.generate(schoolData, { strategyId: StrategyId.BACKTRACKING, optimize: true, seed: 7 });
  const b = scheduler.generate(schoolData, { strategyId: StrategyId.BACKTRACKING, optimize: true, seed: 7 });
  return JSON.stringify(a.lessons.map((l) => l.toJSON())) === JSON.stringify(b.lessons.map((l) => l.toJSON()));
})());
check('different seeds give different timetables', (() => {
  const a = scheduler.generate(schoolData, { seed: 1, optimize: false });
  const b = scheduler.generate(schoolData, { seed: 999, optimize: false });
  return JSON.stringify(a.lessons) !== JSON.stringify(b.lessons);
})());

// ------------------------------------------------- core-period-window shape
console.log('\nCore-subject placement (brief: main subjects in periods 1–6)');
console.log('-'.repeat(72));
{
  const { from, to } = schoolData.settings.corePeriodWindow;
  let coreIn = 0;
  let coreOut = 0;
  for (const lesson of optimised.timetable.lessons) {
    const entry = schoolData.curriculum.find(
      (e) => e.classId === lesson.classId && e.subjectId === lesson.subjectId,
    );
    if (entry?.priority !== 'CORE') continue;
    const period = schoolData.timeGrid.getSlot(lesson.slotId).periodNumber;
    if (period >= from && period <= to) coreIn += 1; else coreOut += 1;
  }
  const pct = Math.round((coreIn / (coreIn + coreOut)) * 100);
  console.log(`  core periods inside window ${from}–${to}: ${coreIn}/${coreIn + coreOut} (${pct}%)`);
  check('most core periods land in the preferred window', pct >= 80, `${pct}%`);
}

// --------------------------------------------------- weekly distribution
console.log('\nWeekly distribution (how often each subject runs)');
console.log('-'.repeat(72));
{
  const grid = schoolData.timeGrid;
  const dayCount = grid.dayCount;

  /** classId|subjectId → Set of day indexes actually used. */
  const daysUsed = new Map();
  for (const lesson of optimised.timetable.lessons) {
    const key = `${lesson.classId}|${lesson.subjectId}`;
    if (!daysUsed.has(key)) daysUsed.set(key, new Set());
    daysUsed.get(key).add(grid.getSlot(lesson.slotId).dayIndex);
  }

  /** Shortest distance between two days, treating the week as a loop. */
  const weekDistance = (a, b) => {
    const direct = Math.abs(a - b);
    return Math.min(direct, dayCount - direct);
  };

  let dailyRows = 0;
  let dailyFullyCovered = 0;
  const dailyMisses = [];

  let spreadRows = 0;
  let spreadWellSeparated = 0;
  const spreadMisses = [];

  for (const entry of schoolData.curriculum) {
    const days = daysUsed.get(`${entry.classId}|${entry.subjectId}`) ?? new Set();
    const className = schoolData.classes.get(entry.classId).name;
    const subjectName = schoolData.subjects.get(entry.subjectId).name;

    if (entry.spread === 'EVERY_DAY') {
      dailyRows += 1;
      if (days.size === dayCount) dailyFullyCovered += 1;
      else dailyMisses.push(`${className}/${subjectName} on ${days.size}/${dayCount} days`);
      continue;
    }
    if (entry.spread !== 'SPREAD_OUT' || entry.periodsPerWeek > 2 || days.size < 2) continue;

    // Two-a-week subjects are the case the user actually notices: Games on
    // Monday and Tuesday is not "twice a week" in any meaningful sense.
    spreadRows += 1;
    const sorted = [...days].sort((a, b) => a - b);
    let closest = Infinity;
    for (let i = 0; i < sorted.length; i += 1) {
      for (let j = i + 1; j < sorted.length; j += 1) {
        closest = Math.min(closest, weekDistance(sorted[i], sorted[j]));
      }
    }
    if (closest >= 2) spreadWellSeparated += 1;
    else spreadMisses.push(`${className}/${subjectName} on adjacent days`);
  }

  console.log(`  "every day" rows fully covering the week: ${dailyFullyCovered}/${dailyRows}`);
  if (dailyMisses.length > 0) console.log(`    ${dailyMisses.slice(0, 4).join('; ')}`);
  console.log(`  twice-a-week rows on non-adjacent days:   ${spreadWellSeparated}/${spreadRows}`);
  if (spreadMisses.length > 0) console.log(`    ${spreadMisses.slice(0, 4).join('; ')}`);

  check('every "every day" subject appears on all working days',
    dailyRows > 0 && dailyFullyCovered === dailyRows,
    `${dailyFullyCovered}/${dailyRows}`);
  check('twice-a-week subjects land on non-adjacent days',
    spreadRows > 0 && spreadWellSeparated / spreadRows >= 0.8,
    `${spreadWellSeparated}/${spreadRows}`);
}

// ------------------------------------------------- robustness across seeds
//
// A single seed proves nothing about the next press of Generate. The solver
// breaks ties randomly, so the honest question is "what fraction of runs come
// back complete?" — which is also what caught the need for restarts: one
// attempt completed 22 of 25 runs, three attempts complete all of them.
console.log('\nRobustness across 15 different seeds');
console.log('-'.repeat(72));
{
  const runs = 15;
  let complete = 0;
  let worstMissing = 0;
  let slowest = 0;

  for (let index = 1; index <= runs; index += 1) {
    const startedAt = performance.now();
    const timetable = scheduler.generate(schoolData, { seed: index * 7919, optimize: true });
    slowest = Math.max(slowest, performance.now() - startedAt);

    const missing = timetable.report.missingPeriods;
    if (missing === 0) complete += 1;
    worstMissing = Math.max(worstMissing, missing);
  }

  console.log(`  complete timetables: ${complete}/${runs}`);
  console.log(`  worst shortfall:     ${worstMissing} period(s)`);
  console.log(`  slowest run:         ${slowest.toFixed(0)}ms`);

  check('every seed produces a complete timetable', complete === runs, `${complete}/${runs}`);
  check('no run exceeds 5 seconds', slowest < 5000, `${slowest.toFixed(0)}ms`);
}

console.log('\n' + '='.repeat(72));
console.log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
