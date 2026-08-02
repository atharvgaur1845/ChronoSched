/**
 * @file generate-seeds.mjs
 * @description Generates `data/*.seed.json` and proves the demo school is
 * actually schedulable before writing it.
 *
 * The seeds are generated rather than hand-written because a demo school that
 * cannot be scheduled is worse than no demo at all — the first thing a new user
 * does is press Generate, and a red "12 periods could not be placed" makes the
 * app look broken when the data was at fault. Every constraint that can be
 * checked on paper is checked here: class capacity, teacher weekly and daily
 * caps, per-subject daily maxima, and "every day" rows having enough periods.
 *
 * Run: npm run seeds
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
mkdirSync(OUT, { recursive: true });

const SCHEMA_VERSION = 1;
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const PERIODS = 8;

const settings = {
  school: { name: 'Sh Brahamrishi Vidya Mandir Convent', academicYear: '2026-27' },
  workingDays: DAYS,
  dayStart: '08:00',
  periodDurationMinutes: 40,
  periodCount: PERIODS,
  breaks: [
    { afterPeriod: 4, label: 'Recess', durationMinutes: 20, isRecess: true },
    { afterPeriod: 6, label: 'Short Break', durationMinutes: 10, isRecess: false },
  ],
  corePeriodWindow: { from: 1, to: 6 },
  constraintWeights: {
    corePeriodWindow: 10,
    weeklyDistribution: 8,
    recessSidePreference: 6,
    teacherGap: 4,
    preferredFreePeriod: 3,
    difficultySpread: 5,
    subjectSpread: 5,
    teacherDailyBalance: 2,
  },
};

const classes = [
  { id: 'cls_10a', name: '10A', gradeLevel: 10, section: 'A', studentCount: 42, roomId: null },
  { id: 'cls_10b', name: '10B', gradeLevel: 10, section: 'B', studentCount: 40, roomId: null },
  { id: 'cls_11a', name: '11A', gradeLevel: 11, section: 'A', studentCount: 38, roomId: null },
  { id: 'cls_11b', name: '11B', gradeLevel: 11, section: 'B', studentCount: 36, roomId: null },
  { id: 'cls_12s', name: '12 Science', gradeLevel: 12, section: 'Science', studentCount: 34, roomId: null },
  { id: 'cls_12c', name: '12 Commerce', gradeLevel: 12, section: 'Commerce', studentCount: 32, roomId: null },
];

// [id, name, short, type, difficulty, colorSlot]
const subjects = [
  ['sub_eng', 'English', 'ENG', 'THEORY', 3, 1],
  ['sub_hin', 'Hindi', 'HIN', 'THEORY', 2, 2],
  ['sub_mat', 'Mathematics', 'MAT', 'THEORY', 5, 3],
  ['sub_sci', 'Science', 'SCI', 'THEORY', 4, 4],
  ['sub_sst', 'Social Science', 'SST', 'THEORY', 3, 5],
  ['sub_phy', 'Physics', 'PHY', 'THEORY', 5, 6],
  ['sub_che', 'Chemistry', 'CHE', 'THEORY', 4, 7],
  ['sub_bio', 'Biology', 'BIO', 'THEORY', 4, 8],
  ['sub_cs', 'Computer Science', 'CS', 'THEORY', 3, 9],
  ['sub_acc', 'Accountancy', 'ACC', 'THEORY', 4, 10],
  ['sub_bst', 'Business Studies', 'BST', 'THEORY', 3, 1],
  ['sub_eco', 'Economics', 'ECO', 'THEORY', 4, 2],
  ['sub_phl', 'Physics Lab', 'PHL', 'LAB', 3, 6],
  ['sub_chl', 'Chemistry Lab', 'CHL', 'LAB', 3, 7],
  ['sub_bil', 'Biology Lab', 'BIL', 'LAB', 3, 8],
  ['sub_csl', 'Computer Lab', 'CSL', 'LAB', 2, 9],
  ['sub_pe', 'Physical Education', 'PE', 'ACTIVITY', 1, 5],
  ['sub_art', 'Art', 'ART', 'ACTIVITY', 1, 4],
  ['sub_lib', 'Library', 'LIB', 'ACTIVITY', 1, 3],
].map(([id, name, shortName, type, difficulty, colorSlot]) =>
  ({ id, name, shortName, type, difficulty, colorSlot }));

// [id, name, employeeId, subjectIds, classIds, maxDay, maxWeek, unavailable, preferredFree]
const teachers = [
  // Anita takes English every day for three classes, so a whole day off would
  // make those EVERY_DAY rows impossible. Her restriction is period-level.
  ['tch_eng1', 'Anita Sharma',    'EMP-1001', ['sub_eng'],            [], 6, 28, [{ dayIndex: 5, periodIndex: 7 }], []],
  ['tch_eng2', 'Rahul Menon',     'EMP-1002', ['sub_eng'],            [], 6, 28, [], [{ dayIndex: 2, periodIndex: 7 }]],
  ['tch_hin1', 'Kavita Joshi',    'EMP-1003', ['sub_hin'],            [], 5, 24, [], []],
  ['tch_mat1', 'Suresh Iyer',     'EMP-1004', ['sub_mat'],            [], 6, 28, [], []],
  ['tch_mat2', 'Priya Nair',      'EMP-1005', ['sub_mat', 'sub_phy'], [], 6, 28, [{ dayIndex: 0, periodIndex: 0 }], []],
  ['tch_mat3', 'Deepak Rao',      'EMP-1006', ['sub_mat', 'sub_eco'], [], 6, 26, [], []],
  ['tch_sci1', 'Meera Das',       'EMP-1007', ['sub_sci'],            [], 6, 26, [], []],
  ['tch_sst1', 'Vikram Singh',    'EMP-1008', ['sub_sst'],            [], 6, 26, [], [{ dayIndex: 4, periodIndex: 7 }]],
  ['tch_cs1',  'Neha Gupta',      'EMP-1009', ['sub_cs', 'sub_csl'],  [], 6, 26, [], []],
  ['tch_phy1', 'Arjun Pillai',    'EMP-1010', ['sub_phy', 'sub_phl'], [], 6, 28, [], []],
  ['tch_che1', 'Sunita Bose',     'EMP-1011', ['sub_che', 'sub_chl'], [], 6, 28, [], []],
  ['tch_bio1', 'Ramesh Kulkarni', 'EMP-1012', ['sub_bio', 'sub_bil'], [], 6, 26, [], []],
  ['tch_acc1', 'Farhan Khan',     'EMP-1013', ['sub_acc'],            [], 6, 26, [], []],
  ['tch_bst1', 'Lakshmi Menon',   'EMP-1014', ['sub_bst'],            [], 6, 24, [], []],
  ['tch_eco1', 'Ganesh Patil',    'EMP-1015', ['sub_eco'],            [], 6, 24, [], []],
  ['tch_pe1',  'Rakesh Yadav',    'EMP-1016', ['sub_pe'],             [], 6, 24, [], []],
  // A part-time art teacher who is not in on Saturdays — the whole-day
  // unavailability case, on a subject that only runs once a week anyway.
  ['tch_art1', 'Divya Rane',      'EMP-1017', ['sub_art'],            [], 4, 12, [{ dayIndex: 5, periodIndex: null }], []],
  ['tch_lib1', 'Shalini Verma',   'EMP-1018', ['sub_lib', 'sub_eng'], [], 5, 20, [], []],
].map(([id, name, employeeId, subjectIds, classIds, maxPeriodsPerDay, maxPeriodsPerWeek, unavailableSlots, preferredFreeSlots]) =>
  ({ id, name, employeeId, subjectIds, classIds, maxPeriodsPerDay, maxPeriodsPerWeek, unavailableSlots, preferredFreeSlots }));

const DAILY = 'EVERY_DAY';
const SPREAD = 'SPREAD_OUT';

/**
 * Curriculum template per class.
 * [subjectId, periodsPerWeek, priority, recessSide, block, teacherId, spread]
 *
 * The distribution column is the point of the demo: core subjects run every
 * day, while Computer Lab, Games, Art and Library run once or twice a week and
 * are pushed apart across it.
 */
const templates = {
  cls_10a: [
    ['sub_eng', 6, 'CORE', 'ANY', 1, 'tch_eng1', DAILY],
    ['sub_hin', 5, 'CORE', 'ANY', 1, 'tch_hin1', SPREAD],
    ['sub_mat', 7, 'CORE', 'BEFORE', 1, 'tch_mat1', DAILY],
    ['sub_sci', 6, 'CORE', 'BEFORE', 1, 'tch_sci1', DAILY],
    ['sub_sst', 6, 'CORE', 'ANY', 1, 'tch_sst1', DAILY],
    ['sub_cs', 3, 'ELECTIVE', 'AFTER', 1, 'tch_cs1', SPREAD],
    ['sub_csl', 2, 'ELECTIVE', 'AFTER', 2, 'tch_cs1', SPREAD],
    ['sub_pe', 2, 'CO_CURRICULAR', 'AFTER', 1, 'tch_pe1', SPREAD],
    ['sub_art', 1, 'CO_CURRICULAR', 'AFTER', 1, 'tch_art1', SPREAD],
    ['sub_lib', 1, 'CO_CURRICULAR', 'AFTER', 1, 'tch_lib1', SPREAD],
  ],
  cls_11a: [
    ['sub_eng', 5, 'CORE', 'ANY', 1, 'tch_eng1', SPREAD],
    ['sub_mat', 7, 'CORE', 'BEFORE', 1, 'tch_mat2', DAILY],
    ['sub_phy', 6, 'CORE', 'BEFORE', 1, 'tch_phy1', DAILY],
    ['sub_che', 6, 'CORE', 'BEFORE', 1, 'tch_che1', DAILY],
    ['sub_bio', 5, 'CORE', 'ANY', 1, 'tch_bio1', SPREAD],
    ['sub_phl', 2, 'ELECTIVE', 'AFTER', 2, 'tch_phy1', SPREAD],
    ['sub_chl', 2, 'ELECTIVE', 'AFTER', 2, 'tch_che1', SPREAD],
    ['sub_bil', 2, 'ELECTIVE', 'AFTER', 2, 'tch_bio1', SPREAD],
    ['sub_pe', 2, 'CO_CURRICULAR', 'AFTER', 1, 'tch_pe1', SPREAD],
    ['sub_lib', 1, 'CO_CURRICULAR', 'AFTER', 1, 'tch_lib1', SPREAD],
  ],
  cls_11b: [
    ['sub_eng', 5, 'CORE', 'ANY', 1, 'tch_eng2', SPREAD],
    ['sub_acc', 7, 'CORE', 'BEFORE', 1, 'tch_acc1', DAILY],
    ['sub_bst', 6, 'CORE', 'BEFORE', 1, 'tch_bst1', DAILY],
    ['sub_eco', 6, 'CORE', 'BEFORE', 1, 'tch_eco1', DAILY],
    ['sub_mat', 5, 'CORE', 'ANY', 1, 'tch_mat3', SPREAD],
    ['sub_csl', 2, 'ELECTIVE', 'AFTER', 2, 'tch_cs1', SPREAD],
    ['sub_pe', 2, 'CO_CURRICULAR', 'AFTER', 1, 'tch_pe1', SPREAD],
    ['sub_art', 1, 'CO_CURRICULAR', 'AFTER', 1, 'tch_art1', SPREAD],
    ['sub_lib', 1, 'CO_CURRICULAR', 'AFTER', 1, 'tch_lib1', SPREAD],
  ],
};
// 10B mirrors 10A; 12 Science mirrors 11A; 12 Commerce mirrors 11B, with the
// English teacher swapped so no one exceeds their weekly cap.
templates.cls_10b = templates.cls_10a.map((row) => [...row]);
templates.cls_12s = templates.cls_11a.map((row) =>
  (row[0] === 'sub_eng' ? ['sub_eng', 5, 'CORE', 'ANY', 1, 'tch_eng2', SPREAD] : [...row]));
templates.cls_12c = templates.cls_11b.map((row) =>
  (row[0] === 'sub_eng' ? ['sub_eng', 5, 'CORE', 'ANY', 1, 'tch_lib1', SPREAD] : [...row]));

/** Subjects needing more periods than there are days must allow 2 per day. */
const capPerDay = (periodsPerWeek, block) => Math.max(block, periodsPerWeek > DAYS.length ? 2 : 1);

const curriculum = [];
for (const [classId, rows] of Object.entries(templates)) {
  for (const [subjectId, periodsPerWeek, priority, recessPreference, block, teacherId, spread] of rows) {
    curriculum.push({
      id: `cur_${classId.replace('cls_', '')}_${subjectId.replace('sub_', '')}`,
      classId,
      subjectId,
      teacherId,
      periodsPerWeek,
      maxPerDay: capPerDay(periodsPerWeek, block),
      priority,
      recessPreference,
      spread,
      requiresConsecutive: block > 1,
      consecutiveBlock: block,
    });
  }
}

// ------------------------------------------------------------------- verify
const capacity = DAYS.length * PERIODS;
const problems = [];

console.log('Class load');
console.log('-'.repeat(60));
for (const item of classes) {
  const rows = curriculum.filter((entry) => entry.classId === item.id);
  const demand = rows.reduce((sum, entry) => sum + entry.periodsPerWeek, 0);
  if (demand > capacity) problems.push(`${item.name}: demand ${demand} > capacity ${capacity}`);

  for (const entry of rows) {
    if (entry.periodsPerWeek > entry.maxPerDay * DAYS.length) {
      problems.push(`${item.name}/${entry.subjectId}: ${entry.periodsPerWeek}/wk cannot fit at ${entry.maxPerDay}/day`);
    }
    if (entry.spread === DAILY && entry.periodsPerWeek < DAYS.length) {
      problems.push(`${item.name}/${entry.subjectId}: marked EVERY_DAY but only ${entry.periodsPerWeek}/wk`);
    }
    // An EVERY_DAY row whose teacher has a whole day off can never reach every
    // day — the exact combination that produced an unschedulable demo school.
    if (entry.spread === DAILY && entry.teacherId) {
      const teacher = teachers.find((item2) => item2.id === entry.teacherId);
      const daysOff = teacher.unavailableSlots.filter((slot) => slot.periodIndex === null);
      if (daysOff.length > 0) {
        problems.push(`${item.name}/${entry.subjectId}: EVERY_DAY but ${teacher.name} is off `
          + `${daysOff.map((slot) => DAYS[slot.dayIndex]).join(', ')}`);
      }
      if (entry.maxPerDay * (DAYS.length - daysOff.length) < entry.periodsPerWeek) {
        problems.push(`${item.name}/${entry.subjectId}: ${entry.periodsPerWeek}/wk cannot fit in `
          + `${DAYS.length - daysOff.length} available days at ${entry.maxPerDay}/day`);
      }
    }
  }
  console.log(`  ${item.name.padEnd(12)} ${String(demand).padStart(2)} / ${capacity}  (${rows.length} subjects)`);
}

console.log('\nTeacher load');
console.log('-'.repeat(60));
let grand = 0;
for (const teacher of teachers) {
  const load = curriculum
    .filter((entry) => entry.teacherId === teacher.id)
    .reduce((sum, entry) => sum + entry.periodsPerWeek, 0);
  grand += load;

  const daysOff = teacher.unavailableSlots.filter((slot) => slot.periodIndex === null).length;
  const availableDays = DAYS.length - daysOff;

  if (load > teacher.maxPeriodsPerWeek) problems.push(`${teacher.name}: ${load} > weekly cap ${teacher.maxPeriodsPerWeek}`);
  if (load > availableDays * teacher.maxPeriodsPerDay) {
    problems.push(`${teacher.name}: ${load}/wk exceeds ${availableDays} days × ${teacher.maxPeriodsPerDay}/day`);
  }
  console.log(`  ${teacher.name.padEnd(18)} ${String(load).padStart(2)} / ${teacher.maxPeriodsPerWeek}`);
}

console.log(`\nTotal teacher-periods: ${grand}`);
console.log(`Curriculum rows: ${curriculum.length}`);
console.log(`Daily subjects: ${curriculum.filter((e) => e.spread === DAILY).length}`
  + ` · spread-out subjects: ${curriculum.filter((e) => e.spread === SPREAD).length}`);

if (problems.length > 0) {
  console.log(`\nPROBLEMS:\n - ${problems.join('\n - ')}`);
  process.exit(1);
}
console.log('\nOK — demo school is feasible on paper.');

// -------------------------------------------------------------------- write
const write = (file, data) =>
  writeFileSync(join(OUT, file), `${JSON.stringify({ schemaVersion: SCHEMA_VERSION, data }, null, 2)}\n`);

write('settings.seed.json', settings);
write('classes.seed.json', classes);
write('subjects.seed.json', subjects);
write('teachers.seed.json', teachers);
write('curriculum.seed.json', curriculum);
console.log(`Wrote 5 seed files to ${OUT}`);
