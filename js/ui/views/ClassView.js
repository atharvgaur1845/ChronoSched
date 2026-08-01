/**
 * @file ClassView.js
 * @description Manage teaching groups (10A, 12 Science …).
 */

import { EntityListView } from './EntityListView.js';
import { SchoolClass } from '../../domain/SchoolClass.js';
import { textField, numberField } from '../components/FormField.js';
import { el } from '../../utils/DomUtils.js';
import { createId } from '../../utils/IdGenerator.js';
import { Events, Routes } from '../../utils/Constants.js';

export class ClassView extends EntityListView {
  /** @returns {string} */
  get title() { return 'Classes'; }

  /** @returns {string} */
  get intro() {
    return 'Each class gets its own timetable. Add every group that needs one, including split streams such as 12 Science and 12 Commerce.';
  }

  /** @returns {*} */
  get repository() { return this.context.repositories.classes; }

  /** @returns {{singular: string, plural: string}} */
  get entityLabel() { return { singular: 'Class', plural: 'Classes' }; }

  /** @returns {string[]} */
  get changeEvents() {
    return [Events.CLASSES_CHANGED, Events.CURRICULUM_CHANGED, Events.SETTINGS_CHANGED];
  }

  /** @returns {*[]} */
  rows() { return this.schoolData.sortedClasses; }

  /**
   * @param {SchoolClass} row
   * @returns {string[]}
   */
  searchableFields(row) { return [row.name, row.section, String(row.gradeLevel)]; }

  /** @returns {import('../components/DataTable.js').ColumnDefinition[]} */
  get columns() {
    const capacity = this.schoolData.timeGrid.slotCount;

    return [
      { key: 'name', header: 'Class', sortValue: (row) => row.sortKey },
      { key: 'gradeLevel', header: 'Grade', numeric: true },
      { key: 'studentCount', header: 'Students', numeric: true, render: (row) => row.studentCount ?? '—' },
      {
        key: 'subjects',
        header: 'Subjects',
        numeric: true,
        sortValue: (row) => this.schoolData.curriculumForClass(row.id).length,
        render: (row) => String(this.schoolData.curriculumForClass(row.id).length),
      },
      {
        key: 'load',
        header: 'Weekly periods',
        sortValue: (row) => this.schoolData.demandForClass(row.id),
        render: (row) => {
          const demand = this.schoolData.demandForClass(row.id);
          const variant = demand > capacity ? 'danger' : demand === 0 ? 'warning' : 'success';
          const note = demand > capacity ? ' — too many' : '';
          return el('span', { class: `chip chip--${variant}`, text: `${demand} / ${capacity}${note}` });
        },
      },
    ];
  }

  /** @returns {Node[]} */
  extraActions() {
    return [el('button', {
      class: 'button',
      text: 'Set up curriculum',
      on: { click: () => this.context.router.navigate(Routes.CURRICULUM) },
    })];
  }

  /**
   * @param {SchoolClass|null} entity
   * @returns {Node}
   */
  buildForm(entity) {
    const name = textField({
      label: 'Class name',
      value: entity?.name ?? '',
      required: true,
      placeholder: '10A',
      help: 'Exactly as it should appear on the printed timetable. Example: type "12 Science" and every export shows "12 Science".',
    });

    const grade = numberField({
      label: 'Grade level',
      value: entity?.gradeLevel ?? 10,
      min: 1,
      max: 15,
      help: 'Used only for sorting, so 9B appears above 10A instead of below it.',
    });

    const section = textField({
      label: 'Section',
      value: entity?.section ?? '',
      placeholder: 'A',
      help: 'The part after the grade number. Leave blank if the class has no section.',
    });

    const students = numberField({
      label: 'Number of students',
      value: entity?.studentCount ?? '',
      min: 0,
      max: 200,
      help: 'Optional, for your records. It does not affect scheduling today, but will be used when room capacity is added.',
    });

    // Typing "12 Science" should fill grade and section automatically — the
    // administrator has already said it once and should not repeat themselves.
    name.input.addEventListener('input', () => {
      if (entity) return;
      grade.input.value = String(SchoolClass.deriveGradeLevel(name.input.value) || '');
      section.input.value = SchoolClass.deriveSection(name.input.value);
    });

    /** @private */ this._form = { name, grade, section, students };

    return el('div', { class: 'form-grid' }, [
      name.wrapper, grade.wrapper, section.wrapper, students.wrapper,
    ]);
  }

  /**
   * @param {SchoolClass|null} entity
   * @returns {SchoolClass|null}
   */
  readForm(entity) {
    const { name, grade, section, students } = this._form;

    if (name.input.value.trim().length === 0) {
      this.toast('A class name is required.', 'danger');
      name.input.focus();
      return null;
    }

    return new SchoolClass({
      id: entity?.id ?? createId('cls'),
      name: name.input.value,
      gradeLevel: Number(grade.input.value) || 0,
      section: section.input.value,
      studentCount: students.input.value === '' ? null : Number(students.input.value),
      roomId: entity?.roomId ?? null,
    });
  }

  /**
   * @param {SchoolClass} entity
   * @returns {string}
   */
  deleteWarning(entity) {
    const rows = this.schoolData.curriculumForClass(entity.id).length;
    return rows === 0
      ? 'This class has no curriculum, so nothing else is affected.'
      : `Its ${rows} curriculum row(s) and every scheduled period for this class will be removed from all timetable versions.`;
  }
}
