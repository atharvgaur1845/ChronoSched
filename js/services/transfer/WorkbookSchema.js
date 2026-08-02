/**
 * @file WorkbookSchema.js
 * @description The contract for the Excel workbook, shared by importer and exporter.
 *
 * WHY ONE SHARED DEFINITION
 * If the exporter writes "Periods/Week" and the importer looks for
 * "Periods per week", a file exported by the app cannot be re-imported by it —
 * the single most embarrassing bug an import/export feature can have. Both
 * sides read their column names from here, so a round trip is correct by
 * construction.
 *
 * WHY THE SHEETS USE NAMES, NOT IDS
 * Internal ids like `tch_lz3k9d_a7fq` are meaningless to the person editing the
 * spreadsheet. Columns therefore hold "Anita Sharma" and "Mathematics", and the
 * importer resolves them back to ids, reporting unresolvable rows individually
 * rather than failing the whole file.
 */

import { SubjectType, Priority, RecessSide, Spread } from '../../utils/Constants.js';

/** Sheet names, in the order they appear in an exported workbook. */
export const SHEETS = Object.freeze({
  CLASSES: 'Classes',
  SUBJECTS: 'Subjects',
  TEACHERS: 'Teachers',
  CURRICULUM: 'Curriculum',
  TIMETABLE: 'Timetable',
  README: 'How to use',
});

/** Separator for multi-value cells such as a teacher's subject list. */
export const LIST_SEPARATOR = ', ';

/**
 * Column definitions per sheet.
 * `key` is the internal field, `header` is what the user sees.
 * @type {Record<string, Array<{key: string, header: string, width: number}>>}
 */
export const COLUMNS = Object.freeze({
  [SHEETS.CLASSES]: [
    { key: 'name', header: 'Class Name', width: 18 },
    { key: 'gradeLevel', header: 'Grade', width: 8 },
    { key: 'section', header: 'Section', width: 12 },
    { key: 'studentCount', header: 'Students', width: 10 },
  ],
  [SHEETS.SUBJECTS]: [
    { key: 'name', header: 'Subject Name', width: 24 },
    { key: 'shortName', header: 'Short Code', width: 12 },
    { key: 'type', header: 'Type', width: 12 },
    { key: 'difficulty', header: 'Difficulty (1-5)', width: 16 },
  ],
  [SHEETS.TEACHERS]: [
    { key: 'employeeId', header: 'Employee ID', width: 14 },
    { key: 'name', header: 'Teacher Name', width: 22 },
    { key: 'subjects', header: 'Subjects', width: 34 },
    { key: 'classes', header: 'Classes (blank = any)', width: 24 },
    { key: 'maxPeriodsPerDay', header: 'Max Periods/Day', width: 16 },
    { key: 'maxPeriodsPerWeek', header: 'Max Periods/Week', width: 17 },
    { key: 'unavailable', header: 'Unavailable', width: 26 },
    { key: 'preferredFree', header: 'Preferred Free', width: 22 },
  ],
  [SHEETS.CURRICULUM]: [
    { key: 'class', header: 'Class', width: 16 },
    { key: 'subject', header: 'Subject', width: 22 },
    { key: 'teacher', header: 'Teacher (blank = auto)', width: 24 },
    { key: 'periodsPerWeek', header: 'Periods/Week', width: 14 },
    { key: 'spread', header: 'How Often', width: 15 },
    { key: 'maxPerDay', header: 'Max/Day', width: 10 },
    { key: 'priority', header: 'Priority', width: 15 },
    { key: 'recessPreference', header: 'Recess Side', width: 13 },
    { key: 'consecutiveBlock', header: 'Consecutive Block', width: 18 },
  ],
});

/**
 * Guidance written into the workbook itself, so a file emailed to a colleague
 * carries its own instructions.
 * @type {string[][]}
 */
export const README_ROWS = [
  ['ChronoSched — editing this workbook'],
  [''],
  ['This file can be edited in Excel or Google Sheets and imported back into ChronoSched.'],
  ['Keep the sheet names and the header row exactly as they are.'],
  [''],
  ['Sheet', 'What it holds', 'Notes'],
  ['Classes', 'One row per teaching group', 'Example: 10A, grade 10, section A'],
  ['Subjects', 'The school-wide subject list', `Type must be one of: ${Object.values(SubjectType).join(', ')}`],
  ['Teachers', 'Staff, their subjects and their limits', 'Subjects and Classes are comma-separated names'],
  ['Curriculum', 'Which class studies which subject', 'This is what the generator actually schedules'],
  [''],
  ['Column', 'Format', 'Example'],
  ['Unavailable', 'Day or Day + period, comma-separated', 'Sat, Mon P1, Wed P8'],
  ['Preferred Free', 'Same format as Unavailable', 'Wed P8'],
  ['Priority', Object.values(Priority).join(' / '), 'CORE'],
  ['Recess Side', Object.values(RecessSide).join(' / '), 'BEFORE'],
  ['How Often', Object.values(Spread).join(' / '), 'EVERY_DAY'],
  ['Consecutive Block', '1 for normal, 2+ for double periods', '2'],
  [''],
  ['Periods/Week sets HOW MANY. How Often sets WHEN:'],
  ['EVERY_DAY   one lesson on each working day — Maths, Science, English'],
  ['SPREAD_OUT  keep the days apart — Games twice a week means Mon and Thu, not Mon and Tue'],
  ['FLEXIBLE    no preference; the generator optimises other things instead'],
  [''],
  ['Difference between Unavailable and Preferred Free:'],
  ['Unavailable is absolute — the teacher is never scheduled then.'],
  ['Preferred Free is a request — it is honoured when the timetable allows.'],
];

/**
 * Formats a slot reference list for a spreadsheet cell, e.g. "Sat, Mon P1".
 * @param {Array<{dayIndex: number, periodIndex: number|null}>} slots
 * @param {string[]} dayLabels
 * @returns {string}
 */
export function formatSlotRefs(slots, dayLabels) {
  return slots
    .map((slot) => {
      const day = dayLabels[slot.dayIndex] ?? `Day${slot.dayIndex + 1}`;
      return slot.periodIndex === null ? day : `${day} P${slot.periodIndex + 1}`;
    })
    .join(LIST_SEPARATOR);
}

/**
 * Parses the cell format produced by {@link formatSlotRefs}.
 *
 * Unrecognised entries are skipped rather than throwing, and reported through
 * the returned `problems` list — one typo must not cost the user the row.
 *
 * @param {string} text
 * @param {string[]} dayLabels
 * @returns {{slots: Array<{dayIndex: number, periodIndex: number|null}>, problems: string[]}}
 */
export function parseSlotRefs(text, dayLabels) {
  const slots = [];
  const problems = [];
  const source = String(text ?? '').trim();
  if (source.length === 0) return { slots, problems };

  const lookup = new Map(dayLabels.map((label, index) => [label.toLowerCase(), index]));

  for (const raw of source.split(',')) {
    const token = raw.trim();
    if (token.length === 0) continue;

    const match = token.match(/^([A-Za-z]+)\s*(?:P\s*(\d+))?$/i);
    if (!match) { problems.push(`Could not read "${token}".`); continue; }

    const dayIndex = lookup.get(match[1].toLowerCase());
    if (dayIndex === undefined) { problems.push(`"${match[1]}" is not a working day.`); continue; }

    slots.push({
      dayIndex,
      periodIndex: match[2] === undefined ? null : Number(match[2]) - 1,
    });
  }
  return { slots, problems };
}
