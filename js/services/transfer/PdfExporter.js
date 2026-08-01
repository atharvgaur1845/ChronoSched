/**
 * @file PdfExporter.js
 * @description Prints the timetable to PDF — one page per class or per teacher.
 *
 * This is the artefact that actually goes on a staffroom noticeboard, so
 * legibility beats density: landscape A4, real period times down the side, and
 * the teacher's name under every subject.
 *
 * Uses jsPDF + AutoTable, vendored locally for the same offline reason as
 * SheetJS.
 */

import { IExporter } from './IExporter.js';
import { Result } from '../../core/Result.js';
import { formatTimestamp } from '../../utils/TimeUtils.js';
import { createLogger } from '../../utils/Logger.js';

const log = createLogger('PdfExporter');

/** Grouping modes offered in the export dialog. */
export const PdfMode = Object.freeze({
  BY_CLASS: 'byClass',
  BY_TEACHER: 'byTeacher',
});

export class PdfExporter extends IExporter {
  /** @returns {string} */ get id() { return 'pdf'; }
  /** @returns {string} */ get label() { return 'PDF'; }
  /** @returns {string} */ get extension() { return 'pdf'; }

  /** @returns {string} */
  get description() {
    return 'Print-ready timetable, one page per class or per teacher.';
  }

  /**
   * @param {object} payload
   * @returns {boolean}
   */
  isAvailable(payload) {
    const hasLibrary = typeof globalThis.jspdf?.jsPDF === 'function';
    return hasLibrary && Boolean(payload?.timetable);
  }

  /**
   * @param {object} payload
   * @param {import('../../domain/SchoolData.js').SchoolData} payload.schoolData
   * @param {import('../../domain/Timetable.js').Timetable|null} payload.timetable
   * @param {object} [payload.options]
   * @param {string} [payload.options.mode] One of {@link PdfMode}.
   * @returns {Promise<Result>}
   */
  async export({ schoolData, timetable, options = {} }) {
    if (typeof globalThis.jspdf?.jsPDF !== 'function') {
      return Result.fail('The PDF library did not load. Use your browser\'s Print command instead — the page is print-styled.');
    }
    if (!timetable) {
      return Result.fail('Generate a timetable before exporting it to PDF.');
    }

    const mode = options.mode ?? PdfMode.BY_CLASS;
    const { jsPDF } = globalThis.jspdf;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });

    if (typeof doc.autoTable !== 'function') {
      return Result.fail('The PDF table plugin did not load. Use your browser\'s Print command instead.');
    }

    const subjects = mode === PdfMode.BY_TEACHER
      ? schoolData.sortedTeachers.filter((teacher) => timetable.lessonsForTeacher(teacher.id).length > 0)
      : schoolData.sortedClasses;

    if (subjects.length === 0) {
      return Result.fail(mode === PdfMode.BY_TEACHER
        ? 'No teacher has any scheduled periods in this version.'
        : 'There are no classes to export.');
    }

    try {
      subjects.forEach((entity, index) => {
        if (index > 0) doc.addPage();
        this._renderPage(doc, schoolData, timetable, entity, mode);
      });

      doc.save(this._filename(`${schoolData.settings.school.name}-${timetable.label}-${mode}`));
    } catch (error) {
      log.error('PDF export failed.', error);
      return Result.fail(`Could not create the PDF: ${error.message}`);
    }

    return Result.ok(`Exported ${subjects.length} page(s).`);
  }

  /**
   * Renders one page: a heading block plus the week grid.
   * @private
   */
  _renderPage(doc, schoolData, timetable, entity, mode) {
    const grid = schoolData.timeGrid;
    const isTeacherView = mode === PdfMode.BY_TEACHER;

    doc.setFontSize(16);
    doc.text(`${schoolData.settings.school.name}`, 40, 40);

    doc.setFontSize(12);
    doc.text(isTeacherView ? `Teacher: ${entity.name}` : `Class: ${entity.name}`, 40, 60);

    doc.setFontSize(9);
    doc.setTextColor(120);
    doc.text(
      `${timetable.label}  ·  generated ${formatTimestamp(timetable.createdAt)}  ·  ${schoolData.settings.school.academicYear}`,
      40, 76,
    );
    doc.setTextColor(0);

    const head = [['Period', 'Time', ...grid.days.map((day) => day.label)]];
    /** @type {Array<Array<string>>} */
    const body = [];
    /** @type {number[]} Row indexes that are breaks, styled differently below. */
    const breakRows = [];

    for (const entry of grid.getTimeline()) {
      if (entry.type === 'break') {
        breakRows.push(body.length);
        body.push(['', `${entry.startTime}–${entry.endTime}`,
          ...grid.days.map((_, index) => (index === 0 ? entry.label.toUpperCase() : ''))]);
        continue;
      }

      const cells = grid.days.map((day) => {
        const slot = grid.getSlotAt(day.index, entry.periodIndex);
        if (!slot) return '';

        const lesson = isTeacherView
          ? timetable.getTeacherLesson(entity.id, slot.id)
          : timetable.getLesson(entity.id, slot.id);
        if (!lesson) return '';

        const subject = schoolData.subjects.get(lesson.subjectId)?.name ?? lesson.subjectId;
        const secondary = isTeacherView
          ? schoolData.classes.get(lesson.classId)?.name
          : (lesson.teacherId ? schoolData.teachers.get(lesson.teacherId)?.name : null);

        return secondary ? `${subject}\n${secondary}` : subject;
      });

      body.push([String(entry.periodIndex + 1), `${entry.startTime}–${entry.endTime}`, ...cells]);
    }

    doc.autoTable({
      head,
      body,
      startY: 90,
      theme: 'grid',
      styles: { fontSize: 8, cellPadding: 4, valign: 'middle', halign: 'center', lineColor: 200 },
      headStyles: { fillColor: [51, 85, 221], textColor: 255, fontStyle: 'bold' },
      columnStyles: {
        0: { cellWidth: 42, fontStyle: 'bold' },
        1: { cellWidth: 62, fontSize: 7, textColor: 110 },
      },
      // Break rows are shaded so the eye finds recess instantly.
      didParseCell: (data) => {
        if (data.section === 'body' && breakRows.includes(data.row.index)) {
          data.cell.styles.fillColor = [235, 237, 242];
          data.cell.styles.textColor = [110, 110, 110];
          data.cell.styles.fontSize = 7;
        }
      },
    });

    const pageHeight = doc.internal.pageSize.getHeight();
    doc.setFontSize(7);
    doc.setTextColor(150);
    doc.text('Generated by ChronoSched', 40, pageHeight - 20);
  }
}
