/**
 * @file SubjectView.js
 * @description Manage the school-wide subject catalogue.
 *
 * Note what is NOT on this screen: periods per week, teacher, recess side.
 * Those vary per class and live on the Curriculum screen. Putting them here
 * would mean one "Mathematics" per class and a rename becoming a twelve-row
 * edit — see docs/ARCHITECTURE.md §2.1.
 */

import { EntityListView } from './EntityListView.js';
import { Subject } from '../../domain/Subject.js';
import { textField, numberField, selectField } from '../components/FormField.js';
import { el } from '../../utils/DomUtils.js';
import { createId } from '../../utils/IdGenerator.js';
import { Events, SubjectType } from '../../utils/Constants.js';

/** Plain-English names for the subject types. */
const TYPE_LABELS = {
  [SubjectType.THEORY]: 'Theory — normal classroom lesson',
  [SubjectType.LAB]: 'Lab — practical, usually a double period',
  [SubjectType.ACTIVITY]: 'Activity — PE, library, assembly',
};

export class SubjectView extends EntityListView {
  /** @returns {string} */
  get title() { return 'Subjects'; }

  /** @returns {string} */
  get intro() {
    return 'The list of subjects your school teaches. How many periods each class gets is set on the Curriculum screen.';
  }

  /** @returns {*} */
  get repository() { return this.context.repositories.subjects; }

  /** @returns {{singular: string, plural: string}} */
  get entityLabel() { return { singular: 'Subject', plural: 'Subjects' }; }

  /** @returns {string[]} */
  get changeEvents() { return [Events.SUBJECTS_CHANGED, Events.CURRICULUM_CHANGED, Events.TEACHERS_CHANGED]; }

  /** @returns {*[]} */
  rows() { return this.schoolData.sortedSubjects; }

  /**
   * @param {Subject} row
   * @returns {string[]}
   */
  searchableFields(row) { return [row.name, row.shortName, row.type]; }

  /** @returns {import('../components/DataTable.js').ColumnDefinition[]} */
  get columns() {
    return [
      {
        key: 'name',
        header: 'Subject',
        render: (row) => el('span', { class: 'u-row u-row--tight' }, [
          el('span', {
            class: 'tt-legend__swatch',
            style: { '--subject-fill': row.fillVar, width: '14px', height: '14px' },
          }),
          el('span', { text: row.name }),
        ]),
      },
      { key: 'shortName', header: 'Code' },
      {
        key: 'type',
        header: 'Type',
        render: (row) => el('span', {
          class: `chip ${row.isLab ? 'chip--info' : ''}`,
          text: row.type.charAt(0) + row.type.slice(1).toLowerCase(),
        }),
      },
      {
        key: 'difficulty',
        header: 'Difficulty',
        numeric: true,
        render: (row) => `${'●'.repeat(row.difficulty)}${'○'.repeat(5 - row.difficulty)}`,
      },
      {
        key: 'teachers',
        header: 'Qualified teachers',
        numeric: true,
        sortValue: (row) => this.context.repositories.subjects.qualifiedTeachers(row.id).length,
        render: (row) => {
          const count = this.context.repositories.subjects.qualifiedTeachers(row.id).length;
          return count === 0
            ? el('span', { class: 'chip chip--danger', text: 'none' })
            : String(count);
        },
      },
      {
        key: 'usage',
        header: 'Classes',
        numeric: true,
        sortValue: (row) => this.schoolData.curriculumForSubject(row.id).length,
        render: (row) => String(this.schoolData.curriculumForSubject(row.id).length),
      },
    ];
  }

  /**
   * @param {Subject|null} entity
   * @returns {Node}
   */
  buildForm(entity) {
    const name = textField({
      label: 'Subject name',
      value: entity?.name ?? '',
      required: true,
      placeholder: 'Mathematics',
      help: 'The full name printed on the timetable.',
    });

    const shortName = textField({
      label: 'Short code',
      value: entity?.shortName ?? '',
      placeholder: 'MAT',
      help: 'Shown inside the small timetable cells. Example: "Physical Education" fits as "PE". Leave blank and one is generated.',
    });

    const type = selectField({
      label: 'Type',
      value: entity?.type ?? SubjectType.THEORY,
      options: Object.values(SubjectType).map((value) => ({ value, label: TYPE_LABELS[value] })),
      help: 'Labs are usually given consecutive periods on the Curriculum screen. The type itself does not force that — it is a label plus a hint.',
    });

    const difficulty = numberField({
      label: 'Difficulty (1–5)',
      value: entity?.difficulty ?? 3,
      min: 1,
      max: 5,
      help: 'How demanding the subject is. Example: set Mathematics to 5 and Library to 1, and the generator spreads the hard subjects out instead of stacking Maths, Physics and Chemistry all on Monday.',
    });

    name.input.addEventListener('input', () => {
      if (entity || shortName.input.dataset.touched === 'true') return;
      shortName.input.value = Subject.deriveShortName(name.input.value);
    });
    shortName.input.addEventListener('input', () => { shortName.input.dataset.touched = 'true'; });

    /** @private */ this._form = { name, shortName, type, difficulty };

    return el('div', { class: 'form-grid' }, [
      name.wrapper, shortName.wrapper, type.wrapper, difficulty.wrapper,
    ]);
  }

  /**
   * @param {Subject|null} entity
   * @returns {Subject|null}
   */
  readForm(entity) {
    const { name, shortName, type, difficulty } = this._form;

    if (name.input.value.trim().length === 0) {
      this.toast('A subject name is required.', 'danger');
      name.input.focus();
      return null;
    }

    return new Subject({
      id: entity?.id ?? createId('sub'),
      name: name.input.value,
      shortName: shortName.input.value || undefined,
      type: type.select.value,
      difficulty: Number(difficulty.input.value),
      colorSlot: entity?.colorSlot,
    });
  }

  /**
   * @param {Subject} entity
   * @returns {string}
   */
  deleteWarning(entity) {
    const usage = this.schoolData.curriculumForSubject(entity.id).length;
    return usage === 0
      ? 'No class studies this subject, so nothing else is affected.'
      : `${usage} class(es) still study this subject. Remove those curriculum rows first.`;
  }
}
