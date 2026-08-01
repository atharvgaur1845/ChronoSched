/**
 * @file TeacherView.js
 * @description Manage staff: qualifications, workload limits and availability.
 *
 * The form is where the hard/soft distinction is explained to the person who
 * has to live with it. "Unavailable" and "Preferred free" look identical in the
 * data model and behave completely differently in the solver, so each gets its
 * own colour-coded grid and an example that spells out the consequence.
 */

import { EntityListView } from './EntityListView.js';
import { Teacher } from '../../domain/Teacher.js';
import { textField, numberField, chipMultiSelect, helpHint } from '../components/FormField.js';
import { SlotPicker } from '../components/SlotPicker.js';
import { chipList } from '../components/DataTable.js';
import { el } from '../../utils/DomUtils.js';
import { createId } from '../../utils/IdGenerator.js';
import { Events } from '../../utils/Constants.js';

export class TeacherView extends EntityListView {
  /** @returns {string} */
  get title() { return 'Teachers'; }

  /** @returns {string} */
  get intro() {
    return 'Staff, the subjects they can take, and when they are available. The generator will never break these limits.';
  }

  /** @returns {string} */
  get editorSize() { return 'wide'; }

  /** @returns {*} */
  get repository() { return this.context.repositories.teachers; }

  /** @returns {{singular: string, plural: string}} */
  get entityLabel() { return { singular: 'Teacher', plural: 'Teachers' }; }

  /** @returns {string[]} */
  get changeEvents() {
    return [Events.TEACHERS_CHANGED, Events.CURRICULUM_CHANGED, Events.SUBJECTS_CHANGED, Events.SETTINGS_CHANGED];
  }

  /** @returns {*[]} */
  rows() { return this.schoolData.sortedTeachers; }

  /**
   * @param {Teacher} row
   * @returns {string[]}
   */
  searchableFields(row) {
    return [
      row.name,
      row.employeeId,
      ...row.subjectIds.map((id) => this.schoolData.subjects.get(id)?.name ?? ''),
    ];
  }

  /** @returns {import('../components/DataTable.js').ColumnDefinition[]} */
  get columns() {
    return [
      { key: 'name', header: 'Teacher' },
      { key: 'employeeId', header: 'Employee ID', render: (row) => row.employeeId || '—' },
      {
        key: 'subjects',
        header: 'Subjects',
        sortable: false,
        render: (row) => chipList(
          row.subjectIds.map((id) => this.schoolData.subjects.get(id)?.shortName).filter(Boolean),
          { emptyText: 'none — cannot be scheduled' },
        ),
      },
      {
        key: 'workload',
        header: 'Assigned / limit',
        sortValue: (row) => this.schoolData.committedLoadForTeacher(row.id),
        render: (row) => {
          const committed = this.schoolData.committedLoadForTeacher(row.id);
          const over = committed > row.maxPeriodsPerWeek;
          return el('span', {
            class: `chip ${over ? 'chip--danger' : committed === 0 ? '' : 'chip--success'}`,
            text: `${committed} / ${row.maxPeriodsPerWeek}${over ? ' — over limit' : ''}`,
          });
        },
      },
      { key: 'maxPeriodsPerDay', header: 'Max/day', numeric: true },
      {
        key: 'unavailable',
        header: 'Unavailable',
        numeric: true,
        sortValue: (row) => row.countUnavailable(this.schoolData.timeGrid.dayCount, this.schoolData.timeGrid.periodCount),
        render: (row) => {
          const count = row.countUnavailable(this.schoolData.timeGrid.dayCount, this.schoolData.timeGrid.periodCount);
          return count === 0 ? '—' : `${count} periods`;
        },
      },
    ];
  }

  /**
   * @param {Teacher|null} entity
   * @returns {Node}
   */
  buildForm(entity) {
    const grid = this.schoolData.timeGrid;

    const name = textField({
      label: 'Full name',
      value: entity?.name ?? '',
      required: true,
      placeholder: 'Anita Sharma',
    });

    const employeeId = textField({
      label: 'Employee ID',
      value: entity?.employeeId ?? '',
      placeholder: 'EMP-1001',
      help: 'Your school\'s own staff number. Must be unique — it is how an Excel import matches an existing teacher instead of creating a duplicate.',
    });

    const subjects = chipMultiSelect({
      label: 'Subjects they can teach',
      options: this.schoolData.sortedSubjects.map((subject) => ({ value: subject.id, label: subject.name })),
      selected: entity?.subjectIds ?? [],
      help: 'Tick every subject this teacher is qualified for. Example: tick Physics and Physics Lab, and the generator may give them either when a curriculum row is left on "auto-assign".',
      emptyText: 'Add some subjects first.',
    });

    const classes = chipMultiSelect({
      label: 'Classes they may take (leave all unticked for any class)',
      options: this.schoolData.sortedClasses.map((schoolClass) => ({ value: schoolClass.id, label: schoolClass.name })),
      selected: entity?.classIds ?? [],
      help: 'Restricts who they can be auto-assigned to. Example: tick only 11A and 12 Science, and they will never be given 10B automatically. Leave everything unticked to allow any class.',
      emptyText: 'Add some classes first.',
    });

    const maxPerDay = numberField({
      label: 'Maximum periods per day',
      value: entity?.maxPeriodsPerDay ?? 6,
      min: 0,
      max: grid.periodCount,
      help: `The most lessons this teacher can take in one day. Example: set 4 and they will never appear in more than 4 of the day's ${grid.periodCount} periods, even if their subjects need more.`,
    });

    const maxPerWeek = numberField({
      label: 'Maximum periods per week',
      value: entity?.maxPeriodsPerWeek ?? 30,
      min: 0,
      max: grid.slotCount,
      help: `Their weekly teaching load ceiling. The week has ${grid.slotCount} periods in total. If the curriculum assigns them more than this, the extra periods will be reported as unplaced.`,
    });

    const unavailablePicker = new SlotPicker({
      timeGrid: grid,
      selected: entity?.unavailableSlots ?? [],
      mode: 'block',
    });

    const preferredPicker = new SlotPicker({
      timeGrid: grid,
      selected: entity?.preferredFreeSlots ?? [],
      mode: 'prefer',
    });

    /** @private */ this._form = {
      name, employeeId, subjects, classes, maxPerDay, maxPerWeek,
      unavailablePicker, preferredPicker,
    };

    return el('div', { class: 'u-stack' }, [
      el('div', { class: 'form-grid' }, [name.wrapper, employeeId.wrapper, maxPerDay.wrapper, maxPerWeek.wrapper]),

      subjects.wrapper,
      classes.wrapper,

      el('div', { class: 'field' }, [
        el('span', { class: 'field__label', text: 'Unavailable periods — never schedule' }),
        unavailablePicker.render(),
        helpHint('Click a period to block it, or a day name to block the whole day. This is absolute: the teacher is simply not in the building. Example: block Saturday and no timetable will ever place them on a Saturday, even if that leaves periods unfilled.'),
      ]),

      el('div', { class: 'field' }, [
        el('span', { class: 'field__label', text: 'Preferred free periods — avoid if possible' }),
        preferredPicker.render(),
        helpHint('A request, not a rule. Example: mark Wednesday period 8 and the generator keeps it free unless there is genuinely nowhere else for a lesson to go. Marking too many of these as "unavailable" instead is the most common reason a timetable comes back incomplete.'),
      ]),
    ]);
  }

  /**
   * @param {Teacher|null} entity
   * @returns {Teacher|null}
   */
  readForm(entity) {
    const form = this._form;

    if (form.name.input.value.trim().length === 0) {
      this.toast('A teacher name is required.', 'danger');
      form.name.input.focus();
      return null;
    }

    return new Teacher({
      id: entity?.id ?? createId('tch'),
      name: form.name.input.value,
      employeeId: form.employeeId.input.value,
      subjectIds: form.subjects.getSelected(),
      classIds: form.classes.getSelected(),
      maxPeriodsPerDay: Number(form.maxPerDay.input.value),
      maxPeriodsPerWeek: Number(form.maxPerWeek.input.value),
      unavailableSlots: form.unavailablePicker.getSelection(),
      preferredFreeSlots: form.preferredPicker.getSelection(),
    });
  }

  /**
   * @param {Teacher} entity
   * @returns {string}
   */
  deleteWarning(entity) {
    const assignments = this.schoolData.curriculumForTeacher(entity.id).length;
    return assignments === 0
      ? 'This teacher is not assigned to any curriculum row.'
      : `They are still assigned to ${assignments} curriculum row(s), so the delete will be blocked until those are reassigned.`;
  }
}
