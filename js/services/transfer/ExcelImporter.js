/**
 * @file ExcelImporter.js
 * @description Reads an .xlsx workbook back into domain objects.
 *
 * DESIGN PRINCIPLE: PARSE, THEN PREVIEW, THEN COMMIT.
 * `parse()` never touches stored data. It returns the entities it built plus a
 * per-row problem list, so the UI can show "42 teachers, 3 rows have problems"
 * and let the administrator decide. An importer that writes straight to storage
 * turns one bad spreadsheet into a lost term of work.
 *
 * ROW-LEVEL, NOT FILE-LEVEL, ERRORS.
 * One unrecognised subject name should cost that row, not the file. Every
 * problem carries its sheet and row number so the user can go and fix it.
 */

import { Result } from '../../core/Result.js';
import { SHEETS, COLUMNS, LIST_SEPARATOR, parseSlotRefs } from './WorkbookSchema.js';
import { SchoolClass } from '../../domain/SchoolClass.js';
import { Subject } from '../../domain/Subject.js';
import { Teacher } from '../../domain/Teacher.js';
import { CurriculumEntry } from '../../domain/CurriculumEntry.js';
import { createId } from '../../utils/IdGenerator.js';
import { SubjectType, Priority, RecessSide, Spread } from '../../utils/Constants.js';
import { createLogger } from '../../utils/Logger.js';

const log = createLogger('ExcelImporter');

/**
 * @typedef {object} ImportProblem
 * @property {string} sheet
 * @property {number} row      1-based, matching what Excel shows.
 * @property {'error'|'warning'} level
 * @property {string} message
 */

export class ExcelImporter {
  /** @returns {string} */ get id() { return 'xlsx'; }
  /** @returns {string} */ get label() { return 'Excel workbook'; }
  /** @returns {string} */ get accept() { return '.xlsx,.xls,.csv'; }

  /** @returns {boolean} */
  isAvailable() {
    return typeof globalThis.XLSX !== 'undefined';
  }

  /**
   * Parses a workbook without applying anything.
   *
   * @param {File} file
   * @param {import('../../domain/SchoolData.js').SchoolData} schoolData
   *        Existing data, used to match names to entities that already exist so
   *        an import updates rather than duplicating.
   * @returns {Promise<Result>} `value` is `{entities, problems, summary}`.
   */
  async parse(file, schoolData) {
    if (!this.isAvailable()) {
      return Result.fail('The spreadsheet library did not load, so Excel import is unavailable. Try JSON import instead.');
    }

    let book;
    try {
      const buffer = await file.arrayBuffer();
      book = globalThis.XLSX.read(buffer, { type: 'array' });
    } catch (error) {
      log.error('Workbook read failed.', error);
      return Result.fail(`Could not read "${file.name}". Is it a valid Excel file?`);
    }

    /** @type {ImportProblem[]} */
    const problems = [];

    // Order matters: curriculum rows reference classes, subjects and teachers
    // by name, so those must be resolved first.
    const classes = this._readClasses(book, schoolData, problems);
    const subjects = this._readSubjects(book, schoolData, problems);
    const teachers = this._readTeachers(book, schoolData, subjects, classes, problems);
    const curriculum = this._readCurriculum(book, schoolData, subjects, classes, teachers, problems);

    const summary = {
      classes: classes.length,
      subjects: subjects.length,
      teachers: teachers.length,
      curriculum: curriculum.length,
      errors: problems.filter((problem) => problem.level === 'error').length,
      warnings: problems.filter((problem) => problem.level === 'warning').length,
    };

    if (summary.classes + summary.subjects + summary.teachers + summary.curriculum === 0) {
      return Result.fail('No recognisable sheets were found. The workbook needs at least one of: '
        + `${SHEETS.CLASSES}, ${SHEETS.SUBJECTS}, ${SHEETS.TEACHERS}, ${SHEETS.CURRICULUM}.`);
    }

    return Result.ok({
      entities: { classes, subjects, teachers, curriculum },
      problems,
      summary,
    });
  }

  /**
   * Reads a sheet into objects keyed by our internal field names.
   * @private
   * @returns {Array<{row: number, values: Record<string, *>}>}
   */
  _readSheet(book, sheetName) {
    const sheet = book.Sheets[sheetName];
    if (!sheet) return [];

    const rows = globalThis.XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
    const columns = COLUMNS[sheetName] ?? [];

    // Header matching is case- and space-insensitive so a user who retyped
    // "periods/week" as "Periods / Week" is not punished for it.
    const canonical = (text) => String(text).toLowerCase().replace(/[^a-z0-9]/g, '');
    const headerToKey = new Map(columns.map((column) => [canonical(column.header), column.key]));

    return rows.map((raw, index) => {
      /** @type {Record<string, *>} */
      const values = {};
      for (const [header, value] of Object.entries(raw)) {
        const key = headerToKey.get(canonical(header));
        if (key) values[key] = typeof value === 'string' ? value.trim() : value;
      }
      return { row: index + 2, values };  // +2: 1-based, plus the header row.
    });
  }

  /**
   * Finds an existing entity by name so re-importing updates in place instead
   * of creating a second "Mathematics".
   * @private
   */
  _matchByName(registry, name) {
    const needle = String(name).trim().toLowerCase();
    return registry.find((item) => item.name.toLowerCase() === needle);
  }

  /** @private */
  _readClasses(book, schoolData, problems) {
    const out = [];
    for (const { row, values } of this._readSheet(book, SHEETS.CLASSES)) {
      if (!values.name) {
        problems.push({ sheet: SHEETS.CLASSES, row, level: 'error', message: 'Class Name is empty.' });
        continue;
      }
      const existing = this._matchByName(schoolData.classes, values.name);
      const entity = new SchoolClass({
        id: existing?.id ?? createId('cls'),
        name: values.name,
        gradeLevel: values.gradeLevel === '' ? undefined : Number(values.gradeLevel),
        section: values.section || undefined,
        studentCount: values.studentCount === '' ? null : Number(values.studentCount),
      });

      const validation = entity.validate();
      if (!validation.ok) {
        problems.push({ sheet: SHEETS.CLASSES, row, level: 'error', message: validation.errors.join(' ') });
        continue;
      }
      out.push(entity);
    }
    return out;
  }

  /** @private */
  _readSubjects(book, schoolData, problems) {
    const out = [];
    for (const { row, values } of this._readSheet(book, SHEETS.SUBJECTS)) {
      if (!values.name) {
        problems.push({ sheet: SHEETS.SUBJECTS, row, level: 'error', message: 'Subject Name is empty.' });
        continue;
      }

      let type = String(values.type ?? '').toUpperCase();
      if (type && !Object.values(SubjectType).includes(type)) {
        problems.push({
          sheet: SHEETS.SUBJECTS, row, level: 'warning',
          message: `Type "${values.type}" is not recognised — using ${SubjectType.THEORY}.`,
        });
        type = SubjectType.THEORY;
      }

      const existing = this._matchByName(schoolData.subjects, values.name);
      const entity = new Subject({
        id: existing?.id ?? createId('sub'),
        name: values.name,
        shortName: values.shortName || undefined,
        type: type || SubjectType.THEORY,
        difficulty: values.difficulty === '' ? undefined : Number(values.difficulty),
        colorSlot: existing?.colorSlot,
      });

      const validation = entity.validate();
      if (!validation.ok) {
        problems.push({ sheet: SHEETS.SUBJECTS, row, level: 'error', message: validation.errors.join(' ') });
        continue;
      }
      out.push(entity);
    }
    return out;
  }

  /** @private */
  _readTeachers(book, schoolData, importedSubjects, importedClasses, problems) {
    const subjectByName = this._nameIndex(schoolData.subjects.toArray(), importedSubjects);
    const classByName = this._nameIndex(schoolData.classes.toArray(), importedClasses);
    const dayLabels = schoolData.settings.workingDays;
    const out = [];

    for (const { row, values } of this._readSheet(book, SHEETS.TEACHERS)) {
      if (!values.name) {
        problems.push({ sheet: SHEETS.TEACHERS, row, level: 'error', message: 'Teacher Name is empty.' });
        continue;
      }

      const subjectIds = this._resolveList(values.subjects, subjectByName, 'subject',
        SHEETS.TEACHERS, row, problems);
      const classIds = this._resolveList(values.classes, classByName, 'class',
        SHEETS.TEACHERS, row, problems);

      const unavailable = parseSlotRefs(values.unavailable, dayLabels);
      const preferred = parseSlotRefs(values.preferredFree, dayLabels);
      for (const message of [...unavailable.problems, ...preferred.problems]) {
        problems.push({ sheet: SHEETS.TEACHERS, row, level: 'warning', message });
      }

      const existing = schoolData.teachers.find((teacher) => (values.employeeId
        ? teacher.employeeId.toLowerCase() === String(values.employeeId).toLowerCase()
        : teacher.name.toLowerCase() === String(values.name).toLowerCase()));

      const entity = new Teacher({
        id: existing?.id ?? createId('tch'),
        name: values.name,
        employeeId: values.employeeId || '',
        subjectIds,
        classIds,
        maxPeriodsPerDay: values.maxPeriodsPerDay === '' ? undefined : Number(values.maxPeriodsPerDay),
        maxPeriodsPerWeek: values.maxPeriodsPerWeek === '' ? undefined : Number(values.maxPeriodsPerWeek),
        unavailableSlots: unavailable.slots,
        preferredFreeSlots: preferred.slots,
      });

      const validation = entity.validate();
      if (!validation.ok) {
        problems.push({ sheet: SHEETS.TEACHERS, row, level: 'error', message: validation.errors.join(' ') });
        continue;
      }
      out.push(entity);
    }
    return out;
  }

  /** @private */
  _readCurriculum(book, schoolData, importedSubjects, importedClasses, importedTeachers, problems) {
    const subjectByName = this._nameIndex(schoolData.subjects.toArray(), importedSubjects);
    const classByName = this._nameIndex(schoolData.classes.toArray(), importedClasses);
    const teacherByName = this._nameIndex(schoolData.teachers.toArray(), importedTeachers);
    const seen = new Set();
    const out = [];

    for (const { row, values } of this._readSheet(book, SHEETS.CURRICULUM)) {
      if (!values.class || !values.subject) {
        problems.push({ sheet: SHEETS.CURRICULUM, row, level: 'error', message: 'Class and Subject are both required.' });
        continue;
      }

      const schoolClass = classByName.get(String(values.class).toLowerCase());
      const subject = subjectByName.get(String(values.subject).toLowerCase());

      if (!schoolClass) {
        problems.push({ sheet: SHEETS.CURRICULUM, row, level: 'error', message: `Class "${values.class}" was not found. Add it to the ${SHEETS.CLASSES} sheet.` });
        continue;
      }
      if (!subject) {
        problems.push({ sheet: SHEETS.CURRICULUM, row, level: 'error', message: `Subject "${values.subject}" was not found. Add it to the ${SHEETS.SUBJECTS} sheet.` });
        continue;
      }

      let teacherId = null;
      if (values.teacher) {
        const teacher = teacherByName.get(String(values.teacher).toLowerCase());
        if (teacher) teacherId = teacher.id;
        else problems.push({ sheet: SHEETS.CURRICULUM, row, level: 'warning', message: `Teacher "${values.teacher}" was not found — this subject will be auto-assigned.` });
      }

      const key = `${schoolClass.id}::${subject.id}`;
      if (seen.has(key)) {
        problems.push({ sheet: SHEETS.CURRICULUM, row, level: 'error', message: `${schoolClass.name} already has a row for ${subject.name} earlier in this sheet.` });
        continue;
      }
      seen.add(key);

      const block = Number(values.consecutiveBlock || 1);
      const priority = String(values.priority ?? '').toUpperCase() || Priority.CORE;
      const recess = String(values.recessPreference ?? '').toUpperCase() || RecessSide.ANY;
      const spread = String(values.spread ?? '').toUpperCase().replace(/[\s-]+/g, '_') || Spread.SPREAD_OUT;

      if (!Object.values(Priority).includes(priority)) {
        problems.push({ sheet: SHEETS.CURRICULUM, row, level: 'warning', message: `Priority "${values.priority}" is not recognised — using ${Priority.CORE}.` });
      }
      if (!Object.values(RecessSide).includes(recess)) {
        problems.push({ sheet: SHEETS.CURRICULUM, row, level: 'warning', message: `Recess Side "${values.recessPreference}" is not recognised — using ${RecessSide.ANY}.` });
      }
      if (!Object.values(Spread).includes(spread)) {
        problems.push({ sheet: SHEETS.CURRICULUM, row, level: 'warning', message: `How Often "${values.spread}" is not recognised — using ${Spread.SPREAD_OUT}. Valid values: ${Object.values(Spread).join(', ')}.` });
      }

      const existing = schoolData.curriculum.find(
        (entry) => entry.classId === schoolClass.id && entry.subjectId === subject.id,
      );

      const entity = new CurriculumEntry({
        id: existing?.id ?? createId('cur'),
        classId: schoolClass.id,
        subjectId: subject.id,
        teacherId,
        periodsPerWeek: Number(values.periodsPerWeek || 1),
        maxPerDay: Number(values.maxPerDay || 1),
        priority: Object.values(Priority).includes(priority) ? priority : Priority.CORE,
        recessPreference: Object.values(RecessSide).includes(recess) ? recess : RecessSide.ANY,
        spread: Object.values(Spread).includes(spread) ? spread : Spread.SPREAD_OUT,
        requiresConsecutive: block > 1,
        consecutiveBlock: block,
      });

      const validation = entity.validate();
      if (!validation.ok) {
        problems.push({ sheet: SHEETS.CURRICULUM, row, level: 'error', message: validation.errors.join(' ') });
        continue;
      }
      for (const warning of validation.warnings) {
        problems.push({ sheet: SHEETS.CURRICULUM, row, level: 'warning', message: warning });
      }
      out.push(entity);
    }
    return out;
  }

  /**
   * Name → entity, with imported rows taking precedence over stored ones so a
   * renamed entity resolves to its new name within the same import.
   * @private
   */
  _nameIndex(existing, imported) {
    const index = new Map();
    for (const item of existing) index.set(item.name.toLowerCase(), item);
    for (const item of imported) index.set(item.name.toLowerCase(), item);
    return index;
  }

  /**
   * Resolves a comma-separated name list to ids, warning about each miss.
   * @private
   */
  _resolveList(text, index, kind, sheet, row, problems) {
    const source = String(text ?? '').trim();
    if (source.length === 0) return [];

    const ids = [];
    for (const raw of source.split(LIST_SEPARATOR.trim())) {
      const name = raw.trim();
      if (name.length === 0) continue;

      const match = index.get(name.toLowerCase());
      if (match) ids.push(match.id);
      else problems.push({ sheet, row, level: 'warning', message: `Unknown ${kind} "${name}" was skipped.` });
    }
    return ids;
  }
}
