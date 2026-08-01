/**
 * @file Constants.js
 * @description Application-wide enumerations, storage keys, event names and
 * defaults. This module is the reason no other file contains a magic number
 * or a magic string. It has zero imports by design — everything may depend on
 * it, it may depend on nothing.
 */

/** Schema version of every persisted payload. Bump when a migration is added. */
export const SCHEMA_VERSION = 1;

/** Prefix for every LocalStorage key this app owns. Keeps the origin tidy. */
export const STORAGE_PREFIX = 'chronosched:v1';

/**
 * LocalStorage keys, one per aggregate.
 * Splitting by aggregate (rather than one blob) means editing a teacher does
 * not rewrite the entire timetable history on every keystroke.
 * @readonly @enum {string}
 */
export const StorageKeys = Object.freeze({
  SETTINGS:    `${STORAGE_PREFIX}:settings`,
  TEACHERS:    `${STORAGE_PREFIX}:teachers`,
  CLASSES:     `${STORAGE_PREFIX}:classes`,
  SUBJECTS:    `${STORAGE_PREFIX}:subjects`,
  CURRICULUM:  `${STORAGE_PREFIX}:curriculum`,
  TIMETABLES:  `${STORAGE_PREFIX}:timetables`,
  PREFERENCES: `${STORAGE_PREFIX}:preferences`,
});

/** Paths to the read-only seed files shipped with the build. */
export const SEED_PATHS = Object.freeze({
  [StorageKeys.SETTINGS]:   './data/settings.seed.json',
  [StorageKeys.TEACHERS]:   './data/teachers.seed.json',
  [StorageKeys.CLASSES]:    './data/classes.seed.json',
  [StorageKeys.SUBJECTS]:   './data/subjects.seed.json',
  [StorageKeys.CURRICULUM]: './data/curriculum.seed.json',
});

/**
 * Every event that crosses a module boundary. Views subscribe, services emit.
 * String literals are never used at call sites — a typo there fails silently,
 * a typo here fails loudly.
 * @readonly @enum {string}
 */
export const Events = Object.freeze({
  DATA_READY:          'data:ready',
  TEACHERS_CHANGED:    'teachers:changed',
  CLASSES_CHANGED:     'classes:changed',
  SUBJECTS_CHANGED:    'subjects:changed',
  CURRICULUM_CHANGED:  'curriculum:changed',
  SETTINGS_CHANGED:    'settings:changed',
  TIMETABLES_CHANGED:  'timetables:changed',
  ACTIVE_TIMETABLE:    'timetable:active',
  TIMETABLE_EDITED:    'timetable:edited',
  HISTORY_CHANGED:     'history:changed',
  THEME_CHANGED:       'theme:changed',
  TOAST:               'ui:toast',
  STATUS:              'ui:status',
  NAVIGATE:            'ui:navigate',
  SEARCH_SELECT:       'ui:search-select',
});

/** @readonly @enum {string} */
export const SubjectType = Object.freeze({
  THEORY:   'THEORY',
  LAB:      'LAB',
  ACTIVITY: 'ACTIVITY',
});

/**
 * Curriculum priority. Drives the "core subjects early in the day" rule.
 * @readonly @enum {string}
 */
export const Priority = Object.freeze({
  CORE:          'CORE',
  ELECTIVE:      'ELECTIVE',
  CO_CURRICULAR: 'CO_CURRICULAR',
});

/** Numeric ordering for scheduling — higher gets the grid first. */
export const PRIORITY_RANK = Object.freeze({
  [Priority.CORE]:          3,
  [Priority.ELECTIVE]:      2,
  [Priority.CO_CURRICULAR]: 1,
});

/** @readonly @enum {string} */
export const RecessSide = Object.freeze({
  BEFORE: 'BEFORE',
  AFTER:  'AFTER',
  ANY:    'ANY',
});

/** @readonly @enum {string} */
export const SlotKind = Object.freeze({
  TEACHING: 'TEACHING',
  BREAK:    'BREAK',
});

/** Identifiers of the shipped scheduling strategies. */
export const StrategyId = Object.freeze({
  GREEDY:       'greedy',
  BACKTRACKING: 'backtracking',
});

/** Entity kinds — used by search, import/export and generic repositories. */
export const EntityKind = Object.freeze({
  TEACHER:    'teacher',
  CLASS:      'class',
  SUBJECT:    'subject',
  CURRICULUM: 'curriculum',
});

/** Themes supported by ThemeManager. Add one here + one CSS file. */
export const Theme = Object.freeze({
  LIGHT: 'light',
  DARK:  'dark',
});

/** Toast severities. */
export const ToastLevel = Object.freeze({
  INFO:    'info',
  SUCCESS: 'success',
  WARNING: 'warning',
  DANGER:  'danger',
});

/**
 * Default constraint weights. Higher = the solver tries harder to honour it.
 * Exposed in Settings so an administrator can retune priorities with no code
 * change — this is the Open/Closed Principle made visible to the user.
 */
export const DEFAULT_CONSTRAINT_WEIGHTS = Object.freeze({
  corePeriodWindow:     10,
  recessSidePreference:  6,
  teacherGap:            4,
  preferredFreePeriod:   3,
  difficultySpread:      5,
  subjectSpread:         5,
  teacherDailyBalance:   2,
});

/** Fallback settings used when no seed and no stored settings exist. */
export const DEFAULT_SETTINGS = Object.freeze({
  schemaVersion: SCHEMA_VERSION,
  school: { name: 'My School', academicYear: '2026-27' },
  workingDays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  dayStart: '08:00',
  periodDurationMinutes: 40,
  periodCount: 8,
  breaks: [{ afterPeriod: 4, label: 'Recess', durationMinutes: 20, isRecess: true }],
  corePeriodWindow: { from: 1, to: 6 },
  constraintWeights: { ...DEFAULT_CONSTRAINT_WEIGHTS },
});

/** Hard ceilings that protect the UI from pathological input. */
export const LIMITS = Object.freeze({
  MIN_PERIODS: 1,
  MAX_PERIODS: 14,
  MAX_UNDO_DEPTH: 100,
  MAX_TIMETABLE_VERSIONS: 50,
  /** Backtracking node budget. Beyond this the solver degrades to best-effort. */
  SOLVER_NODE_BUDGET: 250_000,
  /** Local-search improvement passes. */
  OPTIMIZER_ITERATIONS: 4_000,
  SEARCH_RESULT_LIMIT: 8,
  TOAST_DURATION_MS: 4_000,
});

/** Number of subject colour slots declared in the theme files. */
export const SUBJECT_COLOR_SLOTS = 10;

/** Route paths. Router and nav both read from here — never hard-code a hash. */
export const Routes = Object.freeze({
  DASHBOARD:  '#/dashboard',
  TEACHERS:   '#/teachers',
  CLASSES:    '#/classes',
  SUBJECTS:   '#/subjects',
  CURRICULUM: '#/curriculum',
  TIME_CONFIG:'#/time',
  GENERATE:   '#/generate',
  TIMETABLE:  '#/timetable',
  COMPARE:    '#/compare',
  SETTINGS:   '#/settings',
});
