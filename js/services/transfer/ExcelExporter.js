/**
 * @file ExcelExporter.js
 * @description Writes an .xlsx workbook containing the school data and,
 * optionally, the generated timetable.
 *
 * Uses SheetJS, vendored locally rather than pulled from a CDN so the app keeps
 * working in a school with unreliable internet — which is the actual deployment
 * environment, not a hypothetical one.
 *
 * The workbook it produces is the same one {@link ExcelImporter} reads, because
 * both take their column names from WorkbookSchema.
 */

import { IExporter } from './IExporter.js';
import { Result } from '../../core/Result.js';
import { SHEETS, COLUMNS, README_ROWS, LIST_SEPARATOR, formatSlotRefs } from './WorkbookSchema.js';
import { createLogger } from '../../utils/Logger.js';

const log = createLogger('ExcelExporter');

export class ExcelExporter extends IExporter {
  /** @returns {string} */ get id() { return 'xlsx'; }
  /** @returns {string} */ get label() { return 'Excel workbook'; }
  /** @returns {string} */ get extension() { return 'xlsx'; }

  /** @returns {string} */
  get description() {
    return 'Editable spreadsheet of teachers, classes, subjects and the curriculum, plus the current timetable.';
  }

  /** @returns {boolean} */
  isAvailable() {
    return typeof globalThis.XLSX !== 'undefined';
  }

  /**
   * @param {object} payload
   * @param {import('../../domain/SchoolData.js').SchoolData} payload.schoolData
   * @param {import('../../domain/Timetable.js').Timetable|null} [payload.timetable]
   * @returns {Promise<Result>}
   */
  async export({ schoolData, timetable = null }) {
    if (!this.isAvailable()) {
      return Result.fail('The spreadsheet library did not load, so Excel export is unavailable. Try JSON export instead.');
    }

    const XLSX = globalThis.XLSX;
    const book = XLSX.utils.book_new();
    const dayLabels = schoolData.settings.workingDays;

    this._appendSheet(XLSX, book, SHEETS.CLASSES, schoolData.sortedClasses.map((item) => ({
      name: item.name,
      gradeLevel: item.gradeLevel,
      section: item.section,
      studentCount: item.studentCount ?? '',
    })));

    this._appendSheet(XLSX, book, SHEETS.SUBJECTS, schoolData.sortedSubjects.map((item) => ({
      name: item.name,
      shortName: item.shortName,
      type: item.type,
      difficulty: item.difficulty,
    })));

    this._appendSheet(XLSX, book, SHEETS.TEACHERS, schoolData.sortedTeachers.map((teacher) => ({
      employeeId: teacher.employeeId,
      name: teacher.name,
      subjects: teacher.subjectIds
        .map((id) => schoolData.subjects.get(id)?.name)
        .filter(Boolean).join(LIST_SEPARATOR),
      classes: teacher.classIds
        .map((id) => schoolData.classes.get(id)?.name)
        .filter(Boolean).join(LIST_SEPARATOR),
      maxPeriodsPerDay: teacher.maxPeriodsPerDay,
      maxPeriodsPerWeek: teacher.maxPeriodsPerWeek,
      unavailable: formatSlotRefs(teacher.unavailableSlots, dayLabels),
      preferredFree: formatSlotRefs(teacher.preferredFreeSlots, dayLabels),
    })));

    this._appendSheet(XLSX, book, SHEETS.CURRICULUM, schoolData.curriculum.map((entry) => ({
      class: schoolData.classes.get(entry.classId)?.name ?? entry.classId,
      subject: schoolData.subjects.get(entry.subjectId)?.name ?? entry.subjectId,
      teacher: entry.teacherId ? schoolData.teachers.get(entry.teacherId)?.name ?? '' : '',
      periodsPerWeek: entry.periodsPerWeek,
      maxPerDay: entry.maxPerDay,
      priority: entry.priority,
      recessPreference: entry.recessPreference,
      consecutiveBlock: entry.consecutiveBlock,
    })));

    if (timetable) {
      this._appendTimetableSheet(XLSX, book, schoolData, timetable);
    }

    const readme = XLSX.utils.aoa_to_sheet(README_ROWS);
    readme['!cols'] = [{ wch: 22 }, { wch: 42 }, { wch: 34 }];
    XLSX.utils.book_append_sheet(book, readme, SHEETS.README);

    const name = timetable
      ? `${schoolData.settings.school.name}-${timetable.label}`
      : `${schoolData.settings.school.name}-data`;

    try {
      XLSX.writeFile(book, this._filename(name), { compression: true });
    } catch (error) {
      log.error('Excel export failed.', error);
      return Result.fail(`Could not create the spreadsheet: ${error.message}`);
    }

    return Result.ok(timetable
      ? 'Exported school data and the current timetable.'
      : 'Exported school data.');
  }

  /**
   * Writes one sheet from a list of plain row objects.
   * @private
   */
  _appendSheet(XLSX, book, sheetName, rows) {
    const columns = COLUMNS[sheetName];
    const header = columns.map((column) => column.header);
    const body = rows.map((row) => columns.map((column) => row[column.key] ?? ''));

    const sheet = XLSX.utils.aoa_to_sheet([header, ...body]);
    sheet['!cols'] = columns.map((column) => ({ wch: column.width }));
    // Freeze the header row so a 200-teacher sheet stays navigable.
    sheet['!freeze'] = { xSplit: 0, ySplit: 1 };
    XLSX.utils.book_append_sheet(book, sheet, sheetName);
  }

  /**
   * The timetable itself, one block of rows per class: days across the top,
   * periods down the side — the same shape as the on-screen grid, so it is
   * immediately recognisable when printed.
   * @private
   */
  _appendTimetableSheet(XLSX, book, schoolData, timetable) {
    const grid = schoolData.timeGrid;
    /** @type {Array<Array<string|number>>} */
    const rows = [];

    rows.push([`${schoolData.settings.school.name} — ${timetable.label}`]);
    rows.push([`Generated ${new Date(timetable.createdAt).toLocaleString()}`]);
    rows.push([]);

    for (const schoolClass of schoolData.sortedClasses) {
      rows.push([schoolClass.name]);
      rows.push(['Period', 'Time', ...grid.days.map((day) => day.label)]);

      for (const entry of grid.getTimeline()) {
        if (entry.type === 'break') {
          rows.push(['', `${entry.startTime}–${entry.endTime}`, entry.label.toUpperCase(),
            ...new Array(Math.max(0, grid.dayCount - 1)).fill('')]);
          continue;
        }

        const cells = grid.days.map((day) => {
          const slot = grid.getSlotAt(day.index, entry.periodIndex);
          const lesson = slot ? timetable.getLesson(schoolClass.id, slot.id) : null;
          if (!lesson) return '';

          const subject = schoolData.subjects.get(lesson.subjectId)?.name ?? lesson.subjectId;
          const teacher = lesson.teacherId
            ? schoolData.teachers.get(lesson.teacherId)?.name
            : null;
          return teacher ? `${subject}\n${teacher}` : subject;
        });

        rows.push([entry.periodIndex + 1, `${entry.startTime}–${entry.endTime}`, ...cells]);
      }
      rows.push([]);
    }

    const sheet = XLSX.utils.aoa_to_sheet(rows);
    sheet['!cols'] = [{ wch: 8 }, { wch: 14 }, ...grid.days.map(() => ({ wch: 22 }))];
    XLSX.utils.book_append_sheet(book, sheet, SHEETS.TIMETABLE);
  }
}
