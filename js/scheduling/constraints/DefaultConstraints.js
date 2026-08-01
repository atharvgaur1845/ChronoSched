/**
 * @file DefaultConstraints.js
 * @description Assembles the rule set the application ships with.
 *
 * REGISTRATION ORDER IS A PERFORMANCE DECISION, NOT A STYLE ONE.
 * `ConstraintRegistry.isFeasible` returns on the first failure, so the cheapest
 * and most frequently-violated rules go first. Clash checks are single Map
 * lookups and reject the overwhelming majority of candidates; availability and
 * workload rules involve more work and are only reached by candidates that
 * already survived the cheap ones.
 *
 * This is the file to edit when adding a rule. Nothing else in the scheduler,
 * and nothing at all in the UI, needs to know it exists.
 */

import { ConstraintRegistry } from './ConstraintRegistry.js';

import { ClassClashConstraint } from './hard/ClassClashConstraint.js';
import { TeacherClashConstraint } from './hard/TeacherClashConstraint.js';
import { SubjectDailyCapConstraint } from './hard/SubjectDailyCapConstraint.js';
import { TeacherAvailabilityConstraint } from './hard/TeacherAvailabilityConstraint.js';
import { TeacherDailyLoadConstraint } from './hard/TeacherDailyLoadConstraint.js';
import { TeacherWeeklyLoadConstraint } from './hard/TeacherWeeklyLoadConstraint.js';

import { CorePeriodWindowConstraint } from './soft/CorePeriodWindowConstraint.js';
import { RecessSidePreferenceConstraint } from './soft/RecessSidePreferenceConstraint.js';
import { DifficultySpreadConstraint } from './soft/DifficultySpreadConstraint.js';
import { SubjectSpreadConstraint } from './soft/SubjectSpreadConstraint.js';
import { TeacherGapConstraint } from './soft/TeacherGapConstraint.js';
import { PreferredFreePeriodConstraint } from './soft/PreferredFreePeriodConstraint.js';
import { TeacherDailyBalanceConstraint } from './soft/TeacherDailyBalanceConstraint.js';

/**
 * Builds the standard registry.
 * @returns {ConstraintRegistry}
 */
export function createDefaultConstraintRegistry() {
  return new ConstraintRegistry()
    // Hard — cheapest first.
    .registerHard(new ClassClashConstraint())
    .registerHard(new TeacherClashConstraint())
    .registerHard(new SubjectDailyCapConstraint())
    .registerHard(new TeacherAvailabilityConstraint())
    .registerHard(new TeacherDailyLoadConstraint())
    .registerHard(new TeacherWeeklyLoadConstraint())
    // Soft — order is irrelevant, all are always evaluated.
    .registerSoft(new CorePeriodWindowConstraint())
    .registerSoft(new RecessSidePreferenceConstraint())
    .registerSoft(new DifficultySpreadConstraint())
    .registerSoft(new SubjectSpreadConstraint())
    .registerSoft(new TeacherGapConstraint())
    .registerSoft(new PreferredFreePeriodConstraint())
    .registerSoft(new TeacherDailyBalanceConstraint());
}

/**
 * Human-readable labels for the weight sliders in Settings, keyed by the
 * `weightKey` each soft constraint declares.
 * @type {Array<{key: string, label: string, help: string}>}
 */
export const WEIGHT_DESCRIPTORS = [
  {
    key: 'corePeriodWindow',
    label: 'Main subjects early in the day',
    help: 'Raise this to push Maths, Science and other core subjects into the first periods. '
      + 'Example: at a high value, 10A gets Maths in period 2 and Library in period 8 instead of the other way round.',
  },
  {
    key: 'recessSidePreference',
    label: 'Respect before / after recess',
    help: 'Raise this to honour each subject\'s recess-side choice more strictly. '
      + 'Example: Physics Lab marked "after recess" will avoid period 3 even if that leaves a gap.',
  },
  {
    key: 'difficultySpread',
    label: 'Spread difficult subjects',
    help: 'Raise this to stop hard subjects clustering on one day. '
      + 'Example: instead of Maths, Physics and Chemistry all on Monday, they land on Monday, Wednesday and Friday.',
  },
  {
    key: 'subjectSpread',
    label: 'Spread each subject across the week',
    help: 'Raise this to avoid the same subject twice in one day. '
      + 'Example: 6 English periods become one a day rather than three doubles.',
  },
  {
    key: 'teacherGap',
    label: 'Avoid teacher idle periods',
    help: 'Raise this to keep each teacher\'s periods together. '
      + 'Example: Mrs Sharma teaches periods 2, 3 and 4 rather than 1, 4 and 8.',
  },
  {
    key: 'preferredFreePeriod',
    label: 'Respect preferred free periods',
    help: 'Raise this to protect the periods teachers asked to keep free. '
      + 'Example: Mr Menon keeps Wednesday period 8 free unless there is genuinely no alternative.',
  },
  {
    key: 'teacherDailyBalance',
    label: 'Even out teacher workload per day',
    help: 'Raise this to give each teacher a similar number of periods every day. '
      + 'Example: 18 periods become 3 a day instead of 6 on Monday and none on Thursday.',
  },
];
