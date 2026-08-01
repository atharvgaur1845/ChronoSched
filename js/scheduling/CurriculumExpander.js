/**
 * @file CurriculumExpander.js
 * @description Turns curriculum rows into the flat list of placements the
 * solver must make, then orders that list most-constrained-first.
 *
 * THE ORDERING IS THE ALGORITHM'S MOST IMPORTANT HEURISTIC.
 * A solver that places easy demands first fills the grid with singles and then
 * discovers there is nowhere left for a double lab, forcing deep backtracking.
 * Placing the hardest demands while the grid is still empty avoids most of that
 * search entirely. This is the classic Minimum-Remaining-Values heuristic from
 * constraint satisfaction, applied to the demand list rather than to variables.
 */

import { LessonDemand } from './LessonDemand.js';

export class CurriculumExpander {
  /**
   * Expands every curriculum row into demands.
   *
   * A row of 5 periods in blocks of 2 becomes two 2-period demands plus one
   * single — never a 2.5-period block, and never five singles that would
   * silently drop the "consecutive" requirement.
   *
   * @param {import('../domain/SchoolData.js').SchoolData} schoolData
   * @param {object} [options]
   * @param {Set<string>} [options.skipCurriculumIds] Rows already satisfied by locked lessons.
   * @param {Map<string, number>} [options.alreadyPlaced] curriculumId → periods already fixed.
   * @returns {LessonDemand[]}
   */
  expand(schoolData, { skipCurriculumIds = new Set(), alreadyPlaced = new Map() } = {}) {
    /** @type {LessonDemand[]} */
    const demands = [];

    for (const entry of schoolData.curriculum) {
      if (skipCurriculumIds.has(entry.id)) continue;

      const subject = schoolData.subjects.get(entry.subjectId);
      if (!subject) continue;               // Orphaned row; ValidationService reports it.
      if (!schoolData.classes.has(entry.classId)) continue;

      const remaining = entry.periodsPerWeek - (alreadyPlaced.get(entry.id) ?? 0);
      if (remaining <= 0) continue;

      const blockSize = entry.requiresConsecutive ? entry.consecutiveBlock : 1;
      const fullBlocks = Math.floor(remaining / blockSize);
      const leftover = remaining % blockSize;

      const shared = {
        curriculumId: entry.id,
        classId: entry.classId,
        subjectId: entry.subjectId,
        fixedTeacherId: entry.teacherId,
        priority: entry.priority,
        priorityRank: entry.priorityRank,
        recessPreference: entry.recessPreference,
        difficulty: subject.difficulty,
        maxPerDay: entry.maxPerDay,
        isLab: subject.isLab,
      };

      for (let index = 0; index < fullBlocks; index += 1) {
        const demandId = `${entry.id}#b${index}`;
        demands.push(new LessonDemand({
          ...shared,
          id: demandId,
          size: blockSize,
          // Derived from the demand rather than randomly generated, so two runs
          // with the same seed produce byte-identical timetables. A random id
          // here silently destroyed reproducibility even though every placement
          // decision was already deterministic.
          blockId: blockSize > 1 ? `blk_${demandId}` : null,
        }));
      }

      // A leftover period cannot honour the block rule — it is placed singly and
      // the report says so, which is more honest than rounding the week up.
      for (let index = 0; index < leftover; index += 1) {
        demands.push(new LessonDemand({
          ...shared,
          id: `${entry.id}#s${index}`,
          size: 1,
          blockId: null,
        }));
      }
    }

    return demands;
  }

  /**
   * Sorts demands hardest-first.
   *
   * Ranking, in order of decreasing importance:
   *   1. Block size          — a double lab has far fewer legal positions.
   *   2. Teacher scarcity    — one eligible teacher is much tighter than five.
   *   3. Recess restriction  — halves the available grid.
   *   4. Priority            — core subjects claim the good periods first.
   *   5. Class pressure      — a class whose week is nearly full has less slack.
   *   6. Id                  — stable tiebreak so a re-run with the same seed
   *                            produces the same ordering.
   *
   * @param {LessonDemand[]} demands
   * @param {import('./SchedulingContext.js').SchedulingContext} context
   * @returns {LessonDemand[]} A new sorted array.
   */
  order(demands, context) {
    /** @type {Map<string, number>} Cached so scoring stays O(1) per demand. */
    const teacherPoolSize = new Map();

    const scoreOf = (demand) => {
      if (!teacherPoolSize.has(demand.id)) {
        teacherPoolSize.set(demand.id, context.eligibleTeachersFor(demand).length);
      }
      const poolSize = Math.max(1, teacherPoolSize.get(demand.id));
      const classPressure = context.classPressure(demand.classId); // 0..1

      return (demand.size * 10_000)
        + ((10 - Math.min(10, poolSize)) * 500)
        + (demand.hasRecessPreference ? 300 : 0)
        + (demand.priorityRank * 100)
        + Math.round(classPressure * 90);
    };

    return [...demands].sort((left, right) => {
      const delta = scoreOf(right) - scoreOf(left);
      return delta !== 0 ? delta : left.id.localeCompare(right.id);
    });
  }
}
