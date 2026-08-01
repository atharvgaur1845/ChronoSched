/**
 * @file CurriculumView.js
 * @description The screen that actually drives the generator: which class
 * studies which subject, how often, with whom, under what rules.
 *
 * Everything the scheduler needs is entered here, so every field carries an
 * example spelling out its effect. The live advisory panel in the editor is the
 * other half of that: it reports "no qualified teacher exists" or "this teacher
 * is now over their weekly limit" while the form is still open, rather than
 * letting the problem surface as a mysterious gap after generation.
 */

import { EntityListView } from './EntityListView.js';
import { CurriculumEntry } from '../../domain/CurriculumEntry.js';
import { selectField, numberField, checkboxField, helpHint } from '../components/FormField.js';
import { el, replaceChildren } from '../../utils/DomUtils.js';
import { createId } from '../../utils/IdGenerator.js';
import { Events, Priority, RecessSide } from '../../utils/Constants.js';

/** Plain-English option labels. */
const PRIORITY_LABELS = {
  [Priority.CORE]: 'Main subject — wants the early periods',
  [Priority.ELECTIVE]: 'Elective — after the main subjects',
  [Priority.CO_CURRICULAR]: 'Co-curricular — PE, library, clubs',
};

const RECESS_LABELS = {
  [RecessSide.ANY]: 'Any time of day',
  [RecessSide.BEFORE]: 'Prefer before recess',
  [RecessSide.AFTER]: 'Prefer after recess',
};

export class CurriculumView extends EntityListView {
  /** @returns {string} */
  get title() { return 'Curriculum'; }

  /** @returns {string} */
  get intro() {
    return 'One row per class-and-subject pair. This is what the generator schedules — a subject with no row here never appears on a timetable.';
  }

  /** @returns {string} */
  get editorSize() { return 'wide'; }

  /** @returns {*} */
  get repository() { return this.context.repositories.curriculum; }

  /** @returns {{singular: string, plural: string}} */
  get entityLabel() { return { singular: 'Curriculum row', plural: 'Curriculum rows' }; }

  /** @returns {string[]} */
  get changeEvents() {
    return [Events.CURRICULUM_CHANGED, Events.CLASSES_CHANGED, Events.SUBJECTS_CHANGED,
      Events.TEACHERS_CHANGED, Events.SETTINGS_CHANGED];
  }

  /** @override */
  constructor(context, params) {
    super(context, params);
    /** @private @type {string} Class filter, '' means all. */
    this._classFilter = params.class ?? '';
  }

  /** @returns {*[]} */
  rows() {
    const all = this.schoolData.curriculum.toArray();
    const scoped = this._classFilter ? all.filter((row) => row.classId === this._classFilter) : all;

    return scoped.sort((left, right) => {
      const leftClass = this.schoolData.classes.get(left.classId)?.sortKey ?? '';
      const rightClass = this.schoolData.classes.get(right.classId)?.sortKey ?? '';
      if (leftClass !== rightClass) return leftClass.localeCompare(rightClass);
      return right.priorityRank - left.priorityRank
        || (this.schoolData.subjects.get(left.subjectId)?.name ?? '')
          .localeCompare(this.schoolData.subjects.get(right.subjectId)?.name ?? '');
    });
  }

  /**
   * @param {CurriculumEntry} row
   * @returns {string[]}
   */
  searchableFields(row) {
    return [
      this.schoolData.classes.get(row.classId)?.name ?? '',
      this.schoolData.subjects.get(row.subjectId)?.name ?? '',
      row.teacherId ? this.schoolData.teachers.get(row.teacherId)?.name ?? '' : 'auto',
    ];
  }

  /** @returns {import('../components/DataTable.js').ColumnDefinition[]} */
  get columns() {
    return [
      {
        key: 'class',
        header: 'Class',
        sortValue: (row) => this.schoolData.classes.get(row.classId)?.sortKey ?? '',
        render: (row) => this.schoolData.classes.get(row.classId)?.name ?? '(deleted)',
      },
      {
        key: 'subject',
        header: 'Subject',
        sortValue: (row) => this.schoolData.subjects.get(row.subjectId)?.name ?? '',
        render: (row) => {
          const subject = this.schoolData.subjects.get(row.subjectId);
          return el('span', { class: 'u-row u-row--tight' }, [
            el('span', {
              class: 'tt-legend__swatch',
              style: { '--subject-fill': subject?.fillVar ?? 'var(--accent-soft)', width: '12px', height: '12px' },
            }),
            el('span', { text: subject?.name ?? '(deleted)' }),
          ]);
        },
      },
      {
        key: 'teacher',
        header: 'Teacher',
        sortValue: (row) => (row.teacherId ? this.schoolData.teachers.get(row.teacherId)?.name ?? '' : 'zz'),
        render: (row) => {
          if (!row.teacherId) {
            const pool = this.schoolData.eligibleTeachersFor(row).length;
            return el('span', {
              class: `chip ${pool === 0 ? 'chip--danger' : 'chip--info'}`,
              text: pool === 0 ? 'nobody qualified' : `auto (${pool} available)`,
            });
          }
          return this.schoolData.teachers.get(row.teacherId)?.name ?? '(deleted)';
        },
      },
      { key: 'periodsPerWeek', header: 'Per week', numeric: true },
      { key: 'maxPerDay', header: 'Max/day', numeric: true },
      {
        key: 'priority',
        header: 'Priority',
        render: (row) => el('span', {
          class: `chip ${row.isCore ? 'chip--accent' : ''}`,
          text: row.priority === Priority.CO_CURRICULAR ? 'Co-curricular'
            : row.priority.charAt(0) + row.priority.slice(1).toLowerCase(),
        }),
      },
      {
        key: 'rules',
        header: 'Rules',
        sortable: false,
        render: (row) => {
          const chips = [];
          if (row.recessPreference !== RecessSide.ANY) {
            chips.push(el('span', { class: 'chip', text: row.recessPreference.toLowerCase() + ' recess' }));
          }
          if (row.requiresConsecutive) {
            chips.push(el('span', { class: 'chip chip--info', text: `${row.consecutiveBlock} together` }));
          }
          return chips.length > 0 ? el('div', { class: 'chip-list' }, chips) : el('span', { class: 'u-muted', text: '—' });
        },
      },
    ];
  }

  /** @returns {Node[]} */
  extraActions() {
    return [el('button', {
      class: 'button',
      text: 'Copy to another class',
      on: { click: () => this._openCopyDialog() },
    })];
  }

  /**
   * Class filter plus a per-class capacity summary. This is the screen where
   * over-subscription happens, so the numbers belong right next to the rows.
   * @returns {Node}
   */
  renderAside() {
    const capacity = this.schoolData.timeGrid.slotCount;

    const filter = el('select', { class: 'select', style: { maxWidth: '220px' } }, [
      el('option', { value: '', text: 'All classes' }),
      ...this.schoolData.sortedClasses.map((schoolClass) => el('option', {
        value: schoolClass.id,
        text: schoolClass.name,
      })),
    ]);
    /** @type {HTMLSelectElement} */ (filter).value = this._classFilter;
    filter.addEventListener('change', () => {
      this._classFilter = /** @type {HTMLSelectElement} */ (filter).value;
      this.refresh();
    });

    const summaries = this.schoolData.sortedClasses
      .filter((schoolClass) => !this._classFilter || schoolClass.id === this._classFilter)
      .map((schoolClass) => {
        const demand = this.schoolData.demandForClass(schoolClass.id);
        const percent = Math.min(100, Math.round((demand / capacity) * 100));
        const variant = demand > capacity ? 'danger' : demand === 0 ? 'warning' : 'success';

        return el('div', { class: 'stat-card', style: { padding: 'var(--space-3) var(--space-4)' } }, [
          el('div', { class: 'u-row' }, [
            el('strong', { text: schoolClass.name }),
            el('span', { class: 'u-spacer' }),
            el('span', { class: `chip chip--${variant}`, text: `${demand}/${capacity}` }),
          ]),
          el('div', { class: 'progress' }, [
            el('div', { class: 'progress__bar', style: { width: `${percent}%` } }),
          ]),
        ]);
      });

    return el('section', { class: 'card' }, [
      el('div', { class: 'card__header' }, [
        el('h2', { text: 'Weekly load per class' }),
        el('span', { class: 'u-spacer' }),
        filter,
      ]),
      el('div', { class: 'card__body' }, [
        el('div', { class: 'stat-grid' }, summaries),
        helpHint(`The week has ${capacity} periods per class (${this.schoolData.timeGrid.dayCount} days × ${this.schoolData.timeGrid.periodCount} periods). A class asking for more than that can never be fully scheduled — reduce periods, or add periods per day in Time Configuration.`),
      ]),
    ]);
  }

  /**
   * @param {CurriculumEntry|null} entity
   * @returns {Node}
   */
  buildForm(entity) {
    const dayCount = this.schoolData.timeGrid.dayCount;

    const classSelect = selectField({
      label: 'Class',
      required: true,
      value: entity?.classId ?? this._classFilter ?? '',
      placeholder: 'Choose a class…',
      options: this.schoolData.sortedClasses.map((item) => ({ value: item.id, label: item.name })),
    });

    const subjectSelect = selectField({
      label: 'Subject',
      required: true,
      value: entity?.subjectId ?? '',
      placeholder: 'Choose a subject…',
      options: this.schoolData.sortedSubjects.map((item) => ({ value: item.id, label: item.name })),
    });

    const teacherSelect = selectField({
      label: 'Teacher',
      value: entity?.teacherId ?? '',
      placeholder: 'Auto — let the generator choose',
      options: this.schoolData.sortedTeachers.map((item) => ({ value: item.id, label: item.labelWithId })),
      help: 'Leave on "Auto" and any qualified, free teacher is used — useful when three people can take English. Pick a name to pin it.',
    });

    const periodsPerWeek = numberField({
      label: 'Periods per week',
      value: entity?.periodsPerWeek ?? 5,
      min: 1,
      max: this.schoolData.timeGrid.slotCount,
      required: true,
      help: `How many lessons of this subject the class gets each week. Example: 6 spreads across the ${dayCount} working days.`,
    });

    const maxPerDay = numberField({
      label: 'Maximum on one day',
      value: entity?.maxPerDay ?? 1,
      min: 1,
      max: this.schoolData.timeGrid.periodCount,
      help: `The most periods of this subject the class can have in a single day. Example: 7 periods a week over ${dayCount} days needs at least 2 here, otherwise one period has nowhere to go.`,
    });

    const priority = selectField({
      label: 'Priority',
      value: entity?.priority ?? Priority.CORE,
      options: Object.values(Priority).map((value) => ({ value, label: PRIORITY_LABELS[value] })),
      help: `Main subjects are pulled into periods ${this.schoolData.settings.corePeriodWindow.from}–${this.schoolData.settings.corePeriodWindow.to}. Example: mark Maths as "Main" and Library as "Co-curricular", and Library ends up in the last period instead of period 2.`,
    });

    const recess = selectField({
      label: 'Recess side',
      value: entity?.recessPreference ?? RecessSide.ANY,
      options: Object.values(RecessSide).map((value) => ({ value, label: RECESS_LABELS[value] })),
      help: 'A preference, not a rule. Example: choose "after recess" for a lab and it lands in the afternoon unless every afternoon slot is taken.',
    });

    const consecutive = checkboxField({
      label: 'Needs consecutive periods',
      checked: entity?.requiresConsecutive ?? false,
      help: 'Keeps this subject\'s periods back-to-back. Example: a 2-period Physics Lab is always scheduled as P5+P6 together, never split across the day or across recess.',
    });

    const blockSize = numberField({
      label: 'Periods per block',
      value: entity?.consecutiveBlock ?? 2,
      min: 2,
      max: 4,
      help: 'How many periods sit together. Example: 4 periods a week in blocks of 2 becomes two double lessons on two different days.',
    });

    const advisories = el('div', { class: 'u-stack' });

    const syncEnabled = () => {
      const on = /** @type {HTMLInputElement} */ (consecutive.input).checked;
      blockSize.wrapper.classList.toggle('u-hidden', !on);
      this._refreshAdvisories(advisories);
    };

    for (const control of [classSelect.select, subjectSelect.select, teacherSelect.select,
      periodsPerWeek.input, maxPerDay.input, blockSize.input]) {
      control.addEventListener('change', () => this._refreshAdvisories(advisories));
    }
    consecutive.input.addEventListener('change', syncEnabled);

    // Choosing a subject narrows the teacher list to people qualified for it —
    // scrolling past 200 names to find the three who teach Chemistry is a
    // reliable way to pick the wrong one.
    subjectSelect.select.addEventListener('change', () => {
      this._filterTeacherOptions(teacherSelect.select, subjectSelect.select.value, classSelect.select.value);
    });
    classSelect.select.addEventListener('change', () => {
      this._filterTeacherOptions(teacherSelect.select, subjectSelect.select.value, classSelect.select.value);
    });

    /** @private */ this._form = {
      classSelect, subjectSelect, teacherSelect, periodsPerWeek,
      maxPerDay, priority, recess, consecutive, blockSize, advisories,
    };

    syncEnabled();

    return el('div', { class: 'u-stack' }, [
      el('div', { class: 'form-grid' }, [
        classSelect.wrapper, subjectSelect.wrapper, teacherSelect.wrapper,
        periodsPerWeek.wrapper, maxPerDay.wrapper, priority.wrapper, recess.wrapper,
      ]),
      el('div', { class: 'form-grid' }, [consecutive.wrapper, blockSize.wrapper]),
      advisories,
    ]);
  }

  /**
   * Narrows the teacher dropdown to qualified staff, keeping an "anyone" escape
   * hatch so an unusual assignment is still possible.
   * @private
   */
  _filterTeacherOptions(select, subjectId, classId) {
    const current = select.value;
    const qualified = subjectId
      ? this.schoolData.teachers.filter((teacher) => teacher.canTeach(subjectId, classId))
      : this.schoolData.sortedTeachers;

    const others = this.schoolData.sortedTeachers.filter(
      (teacher) => !qualified.some((item) => item.id === teacher.id),
    );

    replaceChildren(select, [
      el('option', { value: '', text: 'Auto — let the generator choose' }),
      ...qualified.map((teacher) => el('option', { value: teacher.id, text: teacher.labelWithId })),
      others.length > 0 && el('optgroup', { attrs: { label: 'Not listed as qualified' } },
        others.map((teacher) => el('option', { value: teacher.id, text: teacher.labelWithId }))),
    ]);
    select.value = current;
  }

  /**
   * Live warnings while the form is open.
   * @private
   * @param {HTMLElement} host
   */
  _refreshAdvisories(host) {
    const draft = this._buildDraft(null);
    if (!draft) { replaceChildren(host, []); return; }

    const notes = this.context.repositories.curriculum.advisoriesFor(draft);
    const validation = draft.validate();
    const problems = [
      ...validation.errors.map((message) => ({ level: 'danger', message })),
      ...validation.warnings.map((message) => ({ level: 'warning', message })),
      ...notes.map((message) => ({ level: 'warning', message })),
    ];

    const dayCount = this.schoolData.timeGrid.dayCount;
    if (draft.periodsPerWeek > draft.maxPerDay * dayCount) {
      problems.unshift({
        level: 'danger',
        message: `${draft.periodsPerWeek} periods a week cannot fit at ${draft.maxPerDay} per day over ${dayCount} days. Raise the daily maximum to at least ${Math.ceil(draft.periodsPerWeek / dayCount)}.`,
      });
    }

    replaceChildren(host, problems.map((problem) => el('div', { class: `alert alert--${problem.level}` }, [
      el('span', { class: 'alert__icon', text: problem.level === 'danger' ? '!' : '?' }),
      el('div', { class: 'alert__body', text: problem.message }),
    ])));
  }

  /**
   * @private
   * @param {CurriculumEntry|null} entity
   * @returns {CurriculumEntry|null}
   */
  _buildDraft(entity) {
    const form = this._form;
    if (!form.classSelect.select.value || !form.subjectSelect.select.value) return null;

    const wantsConsecutive = /** @type {HTMLInputElement} */ (form.consecutive.input).checked;

    return new CurriculumEntry({
      id: entity?.id ?? createId('cur'),
      classId: form.classSelect.select.value,
      subjectId: form.subjectSelect.select.value,
      teacherId: form.teacherSelect.select.value || null,
      periodsPerWeek: Number(form.periodsPerWeek.input.value),
      maxPerDay: Number(form.maxPerDay.input.value),
      priority: form.priority.select.value,
      recessPreference: form.recess.select.value,
      requiresConsecutive: wantsConsecutive,
      consecutiveBlock: wantsConsecutive ? Number(form.blockSize.input.value) : 1,
    });
  }

  /**
   * @param {CurriculumEntry|null} entity
   * @returns {CurriculumEntry|null}
   */
  readForm(entity) {
    const draft = this._buildDraft(entity);
    if (!draft) {
      this.toast('Choose both a class and a subject.', 'danger');
      return null;
    }
    return draft;
  }

  /**
   * Bulk copy: setting up 10B after 10A is otherwise a dozen identical forms.
   * @private
   */
  _openCopyDialog() {
    const classes = this.schoolData.sortedClasses;
    if (classes.length < 2) {
      this.toast('You need at least two classes to copy between.', 'warning');
      return;
    }

    const source = selectField({
      label: 'Copy from',
      options: classes.map((item) => ({
        value: item.id,
        label: `${item.name} (${this.schoolData.curriculumForClass(item.id).length} subjects)`,
      })),
      value: this._classFilter || classes[0].id,
    });

    const target = selectField({
      label: 'Copy to',
      options: classes.map((item) => ({ value: item.id, label: item.name })),
      value: classes[1].id,
      help: 'Subjects the target class already has are skipped, so nothing is overwritten.',
    });

    const withTeachers = checkboxField({
      label: 'Also copy teacher assignments',
      checked: false,
      help: 'Usually leave this off — the same teacher rarely takes both classes. With it off, copied rows are set to "Auto".',
    });

    this.context.modals.open({
      title: 'Copy curriculum',
      size: 'narrow',
      body: el('div', { class: 'u-stack' }, [source.wrapper, target.wrapper, withTeachers.wrapper]),
      actions: [
        { label: 'Cancel' },
        {
          label: 'Copy',
          variant: 'primary',
          closes: false,
          onClick: async (close) => {
            const result = await this.context.repositories.curriculum.copyToClass(
              source.select.value,
              target.select.value,
              { includeTeachers: /** @type {HTMLInputElement} */ (withTeachers.input).checked },
            );
            if (!result.ok) { this.toast(result.errors.join(' '), 'danger'); return; }

            this.toast(`Copied ${result.value} subject(s).`, 'success');
            if (result.warnings.length > 0) this.toast(result.warnings.join(' '), 'warning');
            close();
            this.refresh();
          },
        },
      ],
    });
  }

  /** @returns {string} */
  deleteWarning() {
    return 'The class simply stops studying this subject. Existing timetable versions keep their periods until you regenerate.';
  }
}
