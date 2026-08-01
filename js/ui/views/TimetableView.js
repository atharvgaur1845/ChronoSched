/**
 * @file TimetableView.js
 * @description The timetable grid: viewing, filtering, drag-and-drop editing
 * and version management.
 *
 * TWO PROJECTIONS, ONE DATA STRUCTURE
 * "By class" and "by teacher" are the same `Lesson[]` pivoted differently.
 * There is one cell renderer and one drop handler; the mode only changes which
 * key the grid is indexed on. Two separate grids would be two places to fix
 * every future bug.
 *
 * DRAG VALIDATION IS PRECOMPUTED
 * When a drag starts, every slot in the week is checked once and marked green
 * or red. Validating on each `dragover` would re-run the constraint set dozens
 * of times a second, and — more importantly — the user would have to hover over
 * a cell to discover it is illegal. Showing all legal targets up front turns
 * trial and error into a single glance.
 */

import { View } from '../View.js';
import { el, replaceChildren, delegate } from '../../utils/DomUtils.js';
import { helpHint, selectField } from '../components/FormField.js';
import { Events, Routes } from '../../utils/Constants.js';
import { formatTimestamp, formatRelative } from '../../utils/TimeUtils.js';

/** Grid orientation. */
const Mode = Object.freeze({ CLASS: 'class', TEACHER: 'teacher' });

export class TimetableView extends View {
  /** @returns {string} */
  get title() { return 'Timetable'; }

  /** @override */
  constructor(context, params) {
    super(context, params);

    /** @private */ this._mode = params.mode === 'teacher' ? Mode.TEACHER : Mode.CLASS;
    /** @private @type {string} */ this._entityId = params.entity ?? '';
    /** @private @type {number|null} Day filter for narrow screens. */
    this._dayFilter = null;

    /** @private @type {import('../../services/ValidationService.js').ValidationSession|null} */
    this._dragSession = null;
    /** @private @type {import('../../domain/Lesson.js').Lesson|null} */
    this._dragged = null;
  }

  /** @override */
  onMount() {
    this.subscribeAll([Events.TIMETABLES_CHANGED, Events.ACTIVE_TIMETABLE, Events.SETTINGS_CHANGED],
      () => this.refresh());

    // A manual edit only changes cells, so repaint the grid rather than the
    // whole screen — a full refresh would close the toolbar dropdowns.
    this.subscribe(Events.TIMETABLE_EDITED, () => this._renderGrid());

    this.context.editor.syncHistoryOwner(this.context.repositories.timetables.getActive()?.id ?? null);
  }

  /** @returns {Node} */
  render() {
    const timetable = this.context.repositories.timetables.getActive();

    if (!timetable) {
      return el('div', { class: 'view' }, [
        el('header', { class: 'view-header' }, [
          el('div', { class: 'view-header__text' }, [el('h1', { text: 'Timetable' })]),
        ]),
        el('section', { class: 'card' }, [
          el('div', { class: 'card__body' }, [
            el('div', { class: 'empty-state' }, [
              el('div', { class: 'empty-state__icon', text: '▦' }),
              el('div', { class: 'empty-state__title', text: 'No timetable has been generated yet' }),
              el('p', { class: 'u-small u-muted', text: 'Generate one and it will appear here, ready to fine-tune by dragging periods around.' }),
              el('div', { style: { marginTop: 'var(--space-4)' } }, [
                el('button', {
                  class: 'button button--primary',
                  text: 'Go to Generate',
                  on: { click: () => this.context.router.navigate(Routes.GENERATE) },
                }),
              ]),
            ]),
          ]),
        ]),
      ]);
    }

    this._ensureEntitySelected();
    /** @private */ this._gridSlot = el('div', { class: 'timetable-scroll' });

    const view = el('div', { class: 'view' }, [
      this._renderHeader(timetable),
      el('section', { class: 'card' }, [
        this._renderToolbar(timetable),
        this._gridSlot,
        this._renderLegend(),
      ]),
      this._renderVersions(timetable),
    ]);

    // The grid needs the slot element to exist first.
    queueMicrotask(() => this._renderGrid());
    return view;
  }

  // ------------------------------------------------------------------ header

  /**
   * @private
   * @param {import('../../domain/Timetable.js').Timetable} timetable
   * @returns {Node}
   */
  _renderHeader(timetable) {
    const stale = timetable.settingsHash
      && timetable.settingsHash !== this.schoolData.settings.geometryHash;

    return el('header', { class: 'view-header' }, [
      el('div', { class: 'view-header__text' }, [
        el('h1', { text: timetable.label }),
        el('p', {
          class: 'u-secondary u-small',
          text: `${timetable.lessonCount} periods · ${timetable.lockedCount} pinned · created ${formatRelative(timetable.createdAt)}`,
        }),
        stale && el('p', { class: 'chip chip--warning', text: 'Built on a different school day — regenerate to be safe' }),
      ]),
      el('div', { class: 'view-header__actions no-print' }, [
        el('button', { class: 'button', text: 'Print', on: { click: () => window.print() } }),
        el('button', {
          class: 'button',
          text: 'Export',
          on: { click: () => this._openExportDialog(timetable) },
        }),
        el('button', {
          class: 'button button--primary',
          text: 'Generate new version',
          on: { click: () => this.context.router.navigate(Routes.GENERATE) },
        }),
      ]),
    ]);
  }

  // ----------------------------------------------------------------- toolbar

  /**
   * @private
   * @param {import('../../domain/Timetable.js').Timetable} timetable
   * @returns {Node}
   */
  _renderToolbar(timetable) {
    const modeGroup = el('div', { class: 'button-group' }, [
      this._modeButton('By class', Mode.CLASS),
      this._modeButton('By teacher', Mode.TEACHER),
    ]);

    const entityOptions = this._mode === Mode.CLASS
      ? this.schoolData.sortedClasses.map((item) => ({ value: item.id, label: item.name }))
      : this.schoolData.sortedTeachers
        .filter((teacher) => timetable.lessonsForTeacher(teacher.id).length > 0)
        .map((item) => ({ value: item.id, label: item.name }));

    const entity = selectField({
      label: this._mode === Mode.CLASS ? 'Class' : 'Teacher',
      value: this._entityId,
      options: entityOptions.length > 0 ? entityOptions : [{ value: '', label: 'Nothing scheduled' }],
    });
    entity.select.addEventListener('change', () => {
      this._entityId = entity.select.value;
      this._renderGrid();
    });

    const versions = this.context.repositories.timetables.getAllSorted();
    const version = selectField({
      label: 'Version',
      value: timetable.id,
      options: versions.map((item) => ({
        value: item.id,
        label: `${item.label}${item.report?.missingPeriods ? ` — ${item.report.missingPeriods} missing` : ''}`,
      })),
    });
    version.select.addEventListener('change', async () => {
      await this.context.repositories.timetables.setActive(version.select.value);
      this.context.editor.syncHistoryOwner(version.select.value);
    });

    const day = selectField({
      label: 'Day',
      value: this._dayFilter === null ? '' : String(this._dayFilter),
      options: [
        { value: '', label: 'Whole week' },
        ...this.schoolData.timeGrid.days.map((item) => ({ value: String(item.index), label: item.label })),
      ],
      help: 'Choose one day to make the grid easier to read on a phone.',
    });
    day.select.addEventListener('change', () => {
      this._dayFilter = day.select.value === '' ? null : Number(day.select.value);
      this._renderGrid();
    });

    return el('div', { class: 'timetable-toolbar no-print' }, [
      el('div', { class: 'field' }, [
        el('span', { class: 'field__label', text: 'View' }),
        modeGroup,
      ]),
      entity.wrapper,
      version.wrapper,
      day.wrapper,
      el('span', { class: 'u-spacer' }),
      el('div', { class: 'field' }, [
        el('span', { class: 'field__label', text: ' ' }),
        el('button', {
          class: 'button',
          text: 'Compare versions',
          disabled: versions.length < 2,
          on: { click: () => this._openCompareDialog() },
        }),
      ]),
    ]);
  }

  /**
   * @private
   * @param {string} label
   * @param {string} mode
   * @returns {Node}
   */
  _modeButton(label, mode) {
    return el('button', {
      class: 'button',
      text: label,
      attrs: { 'aria-pressed': this._mode === mode ? 'true' : 'false' },
      on: {
        click: () => {
          if (this._mode === mode) return;
          this._mode = mode;
          this._entityId = '';
          this.refresh();
        },
      },
    });
  }

  /**
   * Picks a sensible default subject for the grid when none is chosen.
   * @private
   */
  _ensureEntitySelected() {
    const timetable = this.context.repositories.timetables.getActive();
    if (this._mode === Mode.CLASS) {
      const classes = this.schoolData.sortedClasses;
      if (!classes.some((item) => item.id === this._entityId)) {
        this._entityId = classes[0]?.id ?? '';
      }
      return;
    }

    const busy = this.schoolData.sortedTeachers
      .filter((teacher) => (timetable?.lessonsForTeacher(teacher.id).length ?? 0) > 0);
    if (!busy.some((item) => item.id === this._entityId)) {
      this._entityId = busy[0]?.id ?? '';
    }
  }

  // -------------------------------------------------------------------- grid

  /** @private */
  _renderGrid() {
    if (!this._gridSlot) return;

    const timetable = this.context.repositories.timetables.getActive();
    if (!timetable || !this._entityId) {
      replaceChildren(this._gridSlot, [el('div', { class: 'empty-state' }, [
        el('div', { class: 'empty-state__title', text: 'Nothing to show' }),
        el('p', { class: 'u-small u-muted', text: 'Choose a class or teacher above.' }),
      ])]);
      return;
    }

    const grid = this.schoolData.timeGrid;
    const days = this._dayFilter === null ? grid.days : [grid.days[this._dayFilter]].filter(Boolean);

    const container = el('div', {
      class: 'timetable-grid',
      style: { '--day-count': String(days.length) },
    });

    container.appendChild(el('div', { class: 'tt-corner', text: '' }));
    for (const day of days) {
      container.appendChild(el('div', { class: 'tt-dayhead', text: day.label }));
    }

    for (const entry of grid.getTimeline()) {
      if (entry.type === 'break') {
        container.appendChild(el('div', {
          class: 'tt-break',
          text: `${entry.label} · ${entry.startTime}–${entry.endTime}`,
        }));
        continue;
      }

      container.appendChild(el('div', { class: 'tt-periodhead' }, [
        el('span', { class: 'tt-periodhead__num', text: `Period ${entry.periodIndex + 1}` }),
        el('span', { class: 'tt-periodhead__time', text: `${entry.startTime}–${entry.endTime}` }),
      ]));

      for (const day of days) {
        container.appendChild(this._renderCell(timetable, day.index, entry.periodIndex));
      }
    }

    this._attachGridHandlers(container);
    replaceChildren(this._gridSlot, [container]);
  }

  /**
   * @private
   * @param {import('../../domain/Timetable.js').Timetable} timetable
   * @param {number} dayIndex
   * @param {number} periodIndex
   * @returns {HTMLElement}
   */
  _renderCell(timetable, dayIndex, periodIndex) {
    const slot = this.schoolData.timeGrid.getSlotAt(dayIndex, periodIndex);
    if (!slot) return el('div', { class: 'tt-cell' });

    const isTeacherMode = this._mode === Mode.TEACHER;
    const lesson = isTeacherMode
      ? timetable.getTeacherLesson(this._entityId, slot.id)
      : timetable.getLesson(this._entityId, slot.id);

    const cell = el('div', {
      class: 'tt-cell',
      dataset: { slotId: slot.id, day: dayIndex, period: periodIndex },
    });

    // In teacher mode an empty cell where the teacher is unavailable is hatched,
    // so "free period" and "not in today" are visibly different things.
    if (!lesson && isTeacherMode) {
      const teacher = this.schoolData.teachers.get(this._entityId);
      if (teacher && !teacher.isAvailableAt(dayIndex, periodIndex)) {
        cell.classList.add('tt-cell--unavailable');
        cell.title = 'Marked unavailable';
        return cell;
      }
    }

    if (!lesson) {
      cell.classList.add('tt-cell--free');
      cell.appendChild(el('div', { class: 'tt-free-label', text: 'free' }));
      return cell;
    }

    const subject = this.schoolData.subjects.get(lesson.subjectId);
    const teacher = lesson.teacherId ? this.schoolData.teachers.get(lesson.teacherId) : null;
    const schoolClass = this.schoolData.classes.get(lesson.classId);

    const tile = el('div', {
      class: `tt-lesson${lesson.locked ? ' tt-lesson--locked' : ''}`,
      draggable: !lesson.locked,
      dataset: { slotId: slot.id, classId: lesson.classId },
      style: {
        '--subject-fill': subject?.fillVar ?? 'var(--accent-soft)',
        '--subject-ink': subject?.inkVar ?? 'var(--accent-soft-text)',
      },
      attrs: {
        role: 'button',
        tabindex: '0',
        title: `${subject?.name ?? lesson.subjectId}\n${teacher?.name ?? 'No teacher'}\n${slot.displayName}`
          + `${lesson.locked ? '\nPinned — will survive regeneration' : ''}`,
      },
    }, [
      el('span', { class: 'tt-lesson__subject', text: subject?.shortName ?? '??' }),
      el('span', {
        class: 'tt-lesson__teacher',
        text: isTeacherMode ? schoolClass?.name ?? '' : teacher?.name ?? 'No teacher',
      }),
      lesson.blockId && el('span', { class: 'tt-lesson__meta', text: 'double' }),
    ]);

    if (!teacher) tile.classList.add('tt-lesson--conflict');
    cell.appendChild(tile);
    return cell;
  }

  /**
   * One delegated listener set for the whole grid.
   * @private
   * @param {HTMLElement} container
   */
  _attachGridHandlers(container) {
    delegate(container, 'click', '.tt-lesson', (_event, tile) => {
      const lesson = this._lessonFrom(tile);
      if (lesson) this._openCellMenu(lesson);
    });

    delegate(container, 'keydown', '.tt-lesson', (event, tile) => {
      const key = /** @type {KeyboardEvent} */ (event).key;
      if (key !== 'Enter' && key !== ' ') return;
      event.preventDefault();
      const lesson = this._lessonFrom(tile);
      if (lesson) this._openCellMenu(lesson);
    });

    delegate(container, 'click', '.tt-cell--free', (_event, cell) => {
      this._openInsertDialog(cell.dataset.slotId ?? '');
    });

    delegate(container, 'dragstart', '.tt-lesson', (event, tile) => {
      const lesson = this._lessonFrom(tile);
      if (!lesson) return;

      this._dragged = lesson;
      tile.classList.add('tt-lesson--dragging');

      const transfer = /** @type {DragEvent} */ (event).dataTransfer;
      if (transfer) {
        transfer.effectAllowed = 'move';
        // Firefox refuses to start a drag unless some data is set.
        transfer.setData('text/plain', lesson.cellKey);
      }
      this._highlightTargets(container, lesson);
    });

    delegate(container, 'dragend', '.tt-lesson', (_event, tile) => {
      tile.classList.remove('tt-lesson--dragging');
      this._clearHighlights(container);
      this._dragged = null;
      this._dragSession = null;
    });

    delegate(container, 'dragover', '.tt-cell', (event, cell) => {
      if (!this._dragged) return;
      if (!cell.classList.contains('tt-cell--drop-valid')) return;
      event.preventDefault();
      const transfer = /** @type {DragEvent} */ (event).dataTransfer;
      if (transfer) transfer.dropEffect = 'move';
    });

    delegate(container, 'drop', '.tt-cell', (event, cell) => {
      event.preventDefault();
      const lesson = this._dragged;
      const slotId = cell.dataset.slotId;
      this._clearHighlights(container);
      this._dragged = null;
      if (lesson && slotId) void this._performDrop(lesson, slotId);
    });
  }

  /**
   * Marks every legal destination before the user moves the pointer.
   * @private
   * @param {HTMLElement} container
   * @param {import('../../domain/Lesson.js').Lesson} lesson
   */
  _highlightTargets(container, lesson) {
    const session = this.context.editor.openSession();
    if (!session) return;
    this._dragSession = session;

    const group = this.context.editor.groupFor(lesson);
    const timetable = this.context.repositories.timetables.getActive();

    for (const cell of container.querySelectorAll('.tt-cell')) {
      const slotId = /** @type {HTMLElement} */ (cell).dataset.slotId;
      if (!slotId) continue;

      const occupant = timetable?.getLesson(lesson.classId, slotId);
      let ok;

      if (occupant && occupant !== lesson) {
        ok = group.length === 1 && !occupant.blockId && session.validateSwap(lesson, occupant).ok;
      } else if (group.length > 1) {
        ok = session.validateBlockMove(group, slotId).ok;
      } else {
        ok = session.validateMove(lesson, slotId).ok;
      }

      cell.classList.add(ok ? 'tt-cell--drop-valid' : 'tt-cell--drop-invalid');
    }
  }

  /**
   * @private
   * @param {HTMLElement} container
   */
  _clearHighlights(container) {
    for (const cell of container.querySelectorAll('.tt-cell--drop-valid, .tt-cell--drop-invalid')) {
      cell.classList.remove('tt-cell--drop-valid', 'tt-cell--drop-invalid');
    }
  }

  /**
   * @private
   * @param {import('../../domain/Lesson.js').Lesson} lesson
   * @param {string} slotId
   */
  async _performDrop(lesson, slotId) {
    const timetable = this.context.repositories.timetables.getActive();
    if (!timetable) return;

    const occupant = timetable.getLesson(lesson.classId, slotId);
    const result = occupant && occupant !== lesson
      ? await this.context.editor.swap(lesson, occupant)
      : await this.context.editor.move(lesson, slotId);

    if (!result.ok) { this.toast(result.errors.join(' '), 'danger'); return; }
    for (const warning of result.warnings) this.toast(warning, 'warning');

    this._renderGrid();
  }

  /**
   * @private
   * @param {HTMLElement} tile
   * @returns {import('../../domain/Lesson.js').Lesson|undefined}
   */
  _lessonFrom(tile) {
    const timetable = this.context.repositories.timetables.getActive();
    const { classId, slotId } = tile.dataset;
    return classId && slotId ? timetable?.getLesson(classId, slotId) : undefined;
  }

  // ------------------------------------------------------------- cell dialog

  /**
   * @private
   * @param {import('../../domain/Lesson.js').Lesson} lesson
   */
  _openCellMenu(lesson) {
    const subject = this.schoolData.subjects.get(lesson.subjectId);
    const slot = this.schoolData.timeGrid.getSlot(lesson.slotId);
    const schoolClass = this.schoolData.classes.get(lesson.classId);

    const eligible = this.schoolData.teachers.filter(
      (teacher) => teacher.canTeach(lesson.subjectId, lesson.classId),
    );
    const others = this.schoolData.sortedTeachers.filter(
      (teacher) => !eligible.some((item) => item.id === teacher.id),
    );

    const teacherPicker = selectField({
      label: 'Teacher',
      value: lesson.teacherId ?? '',
      options: [
        ...eligible.map((teacher) => ({ value: teacher.id, label: `${teacher.name} (qualified)` })),
        ...others.map((teacher) => ({ value: teacher.id, label: teacher.name })),
      ],
      placeholder: 'No teacher',
      help: 'Changing this checks for clashes first. A teacher already busy in this period will be refused with an explanation.',
    });

    const { close } = this.context.modals.open({
      title: `${subject?.name ?? 'Lesson'} — ${schoolClass?.name ?? ''}`,
      size: 'narrow',
      body: el('div', { class: 'u-stack' }, [
        el('p', { class: 'u-secondary', text: slot?.displayName ?? '' }),
        lesson.blockId && el('div', { class: 'alert alert--info' }, [
          el('span', { class: 'alert__icon', text: 'i' }),
          el('div', { class: 'alert__body', text: 'This is part of a double period. Moving, clearing or reassigning it affects both periods together.' }),
        ]),
        teacherPicker.wrapper,
        el('div', { class: 'u-row' }, [
          el('button', {
            class: 'button',
            text: lesson.locked ? 'Unpin' : 'Pin this period',
            on: {
              click: async () => {
                const result = await this.context.editor.toggleLock(lesson);
                this.reportResult(result, lesson.locked ? 'Unpinned.' : 'Pinned — it will survive the next generation.');
                this._renderGrid();
                close();
              },
            },
          }),
          el('button', {
            class: 'button button--danger',
            text: 'Clear period',
            on: {
              click: async () => {
                const result = await this.context.editor.clear(lesson);
                this.reportResult(result, 'Period cleared.');
                this._renderGrid();
                close();
              },
            },
          }),
        ]),
        helpHint('Pinned periods are protected: tick "Keep pinned periods" on the Generate screen and the next version schedules around them.'),
      ]),
      actions: [
        { label: 'Close' },
        {
          label: 'Save teacher',
          variant: 'primary',
          closes: false,
          onClick: async (closeDialog) => {
            const result = await this.context.editor.assignTeacher(lesson, teacherPicker.select.value || null);
            if (!this.reportResult(result, 'Teacher updated.')) return;
            this._renderGrid();
            closeDialog();
          },
        },
      ],
    });
  }

  /**
   * @private
   * @param {string} slotId
   */
  _openInsertDialog(slotId) {
    if (this._mode === Mode.TEACHER) {
      this.toast('Switch to "By class" to add a lesson — a period belongs to a class.', 'info');
      return;
    }

    const slot = this.schoolData.timeGrid.getSlot(slotId);
    const rows = this.schoolData.curriculumForClass(this._entityId);

    if (rows.length === 0) {
      this.toast('This class has no curriculum, so there is nothing to add.', 'warning');
      return;
    }

    const subjectPicker = selectField({
      label: 'Subject',
      options: rows.map((row) => {
        const subject = this.schoolData.subjects.get(row.subjectId);
        return { value: row.subjectId, label: subject?.name ?? row.subjectId };
      }),
      help: 'Only subjects in this class\'s curriculum are offered. Adding a period here does not change the weekly total the curriculum asks for — the counts on the Generate report will show one extra.',
    });

    const teacherPicker = selectField({
      label: 'Teacher',
      options: this.schoolData.sortedTeachers.map((teacher) => ({ value: teacher.id, label: teacher.name })),
      placeholder: 'No teacher',
    });

    const syncTeachers = () => {
      const row = rows.find((item) => item.subjectId === subjectPicker.select.value);
      if (row?.teacherId) teacherPicker.select.value = row.teacherId;
    };
    subjectPicker.select.addEventListener('change', syncTeachers);
    syncTeachers();

    this.context.modals.open({
      title: `Add a lesson — ${slot?.displayName ?? ''}`,
      size: 'narrow',
      body: el('div', { class: 'u-stack' }, [subjectPicker.wrapper, teacherPicker.wrapper]),
      actions: [
        { label: 'Cancel' },
        {
          label: 'Add',
          variant: 'primary',
          closes: false,
          onClick: async (close) => {
            const result = await this.context.editor.setLesson(
              this._entityId, slotId, subjectPicker.select.value, teacherPicker.select.value || null,
            );
            if (!this.reportResult(result, 'Lesson added.')) return;
            this._renderGrid();
            close();
          },
        },
      ],
    });
  }

  // ---------------------------------------------------------------- versions

  /**
   * @private
   * @param {import('../../domain/Timetable.js').Timetable} active
   * @returns {Node}
   */
  _renderVersions(active) {
    const versions = this.context.repositories.timetables.getAllSorted();

    return el('section', { class: 'card no-print' }, [
      el('div', { class: 'card__header' }, [
        el('h2', { text: `Versions (${versions.length})` }),
        el('span', { class: 'u-spacer' }),
        helpHint('Every generation adds a version. Nothing is ever overwritten.'),
      ]),
      el('div', { class: 'card__body card__body--flush' }, [
        el('div', { class: 'version-list' }, versions.map((version) => {
          const report = version.report ?? {};
          const isActive = version.id === active.id;

          return el('div', { class: 'version-row', dataset: { active: String(isActive) } }, [
            el('div', { style: { minWidth: '0', flex: '1 1 auto' } }, [
              el('div', { class: 'version-row__title', text: version.label }),
              el('div', {
                class: 'version-row__meta',
                text: `${formatTimestamp(version.createdAt)} · ${report.placedPeriods ?? version.lessonCount} periods`
                  + `${report.missingPeriods ? ` · ${report.missingPeriods} missing` : ''}`
                  + ` · cost ${report.softScore ?? '—'}`,
              }),
            ]),
            isActive
              ? el('span', { class: 'chip chip--accent', text: 'Viewing' })
              : el('button', {
                class: 'button button--small',
                text: 'View',
                on: {
                  click: async () => {
                    await this.context.repositories.timetables.setActive(version.id);
                    this.context.editor.syncHistoryOwner(version.id);
                  },
                },
              }),
            el('button', {
              class: 'button button--small button--ghost',
              text: 'Rename',
              on: { click: () => this._rename(version) },
            }),
            el('button', {
              class: 'button button--small button--ghost',
              text: 'Duplicate',
              on: {
                click: async () => {
                  const result = await this.context.repositories.timetables.duplicate(version.id);
                  this.reportResult(result, 'Version duplicated.');
                },
              },
            }),
            el('button', {
              class: 'button button--small button--ghost',
              text: 'Delete',
              on: { click: () => this._deleteVersion(version) },
            }),
          ]);
        })),
      ]),
    ]);
  }

  /**
   * @private
   * @param {import('../../domain/Timetable.js').Timetable} version
   */
  async _rename(version) {
    const label = await this.context.modals.prompt({
      title: 'Rename version',
      label: 'Version name',
      value: version.label,
      help: 'Give it a name you will recognise later. Example: "Approved — Term 2" or "Before Mrs Rao\'s leave".',
    });
    if (label === null) return;

    const result = await this.context.repositories.timetables.rename(version.id, label);
    this.reportResult(result, 'Renamed.');
  }

  /**
   * @private
   * @param {import('../../domain/Timetable.js').Timetable} version
   */
  async _deleteVersion(version) {
    const confirmed = await this.context.modals.confirm({
      title: `Delete ${version.label}?`,
      message: 'This version and its manual edits will be removed.',
      detail: 'Other versions are unaffected. This cannot be undone.',
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (!confirmed) return;

    const result = await this.context.repositories.timetables.remove(version.id);
    this.reportResult(result, 'Version deleted.');
  }

  /**
   * Side-by-side difference between two versions.
   * @private
   */
  _openCompareDialog() {
    const versions = this.context.repositories.timetables.getAllSorted();

    const left = selectField({
      label: 'Compare',
      options: versions.map((item) => ({ value: item.id, label: item.label })),
      value: versions[1]?.id ?? '',
    });
    const right = selectField({
      label: 'Against',
      options: versions.map((item) => ({ value: item.id, label: item.label })),
      value: versions[0]?.id ?? '',
    });

    const output = el('div');

    const update = () => {
      const diff = this.context.repositories.timetables.diff(left.select.value, right.select.value);
      if (!diff) { replaceChildren(output, []); return; }

      const describe = (lesson) => {
        const subject = this.schoolData.subjects.get(lesson.subjectId)?.shortName ?? '??';
        const teacher = lesson.teacherId ? this.schoolData.teachers.get(lesson.teacherId)?.name : 'no teacher';
        return `${subject} (${teacher})`;
      };
      const cellLabel = (key) => {
        const [classId, slotId] = key.split('|');
        const className = this.schoolData.classes.get(classId)?.name ?? classId;
        return `${className} · ${this.schoolData.timeGrid.getSlot(slotId)?.shortLabel ?? slotId}`;
      };

      replaceChildren(output, [
        el('div', { class: 'stat-grid' }, [
          el('div', { class: 'stat-card' }, [
            el('span', { class: 'stat-card__value', text: String(diff.identical) }),
            el('span', { class: 'stat-card__label', text: 'Unchanged' }),
          ]),
          el('div', { class: 'stat-card' }, [
            el('span', { class: 'stat-card__value', text: String(diff.changed.length) }),
            el('span', { class: 'stat-card__label', text: 'Different' }),
          ]),
          el('div', { class: 'stat-card' }, [
            el('span', { class: 'stat-card__value', text: String(diff.added.length) }),
            el('span', { class: 'stat-card__label', text: 'Only on the right' }),
          ]),
          el('div', { class: 'stat-card' }, [
            el('span', { class: 'stat-card__value', text: String(diff.removed.length) }),
            el('span', { class: 'stat-card__label', text: 'Only on the left' }),
          ]),
        ]),
        el('div', { class: 'table-wrap', style: { maxHeight: '340px', overflowY: 'auto', marginTop: 'var(--space-4)' } }, [
          el('table', { class: 'data-table' }, [
            el('thead', {}, [el('tr', {}, [
              el('th', { text: 'Cell' }), el('th', { text: 'Left' }), el('th', { text: 'Right' }),
            ])]),
            el('tbody', {}, [
              ...diff.changed.slice(0, 60).map((item) => el('tr', { class: 'diff-cell--changed' }, [
                el('td', { text: cellLabel(item.key) }),
                el('td', { text: describe(item.left) }),
                el('td', { text: describe(item.right) }),
              ])),
              ...diff.removed.slice(0, 30).map((item) => el('tr', { class: 'diff-cell--removed' }, [
                el('td', { text: cellLabel(item.key) }),
                el('td', { text: describe(item.left) }),
                el('td', { text: '—' }),
              ])),
              ...diff.added.slice(0, 30).map((item) => el('tr', { class: 'diff-cell--added' }, [
                el('td', { text: cellLabel(item.key) }),
                el('td', { text: '—' }),
                el('td', { text: describe(item.right) }),
              ])),
            ]),
          ]),
        ]),
      ]);
    };

    left.select.addEventListener('change', update);
    right.select.addEventListener('change', update);

    this.context.modals.open({
      title: 'Compare versions',
      size: 'wide',
      body: el('div', { class: 'u-stack' }, [
        el('div', { class: 'form-grid' }, [left.wrapper, right.wrapper]),
        output,
      ]),
      actions: [{ label: 'Close', variant: 'primary' }],
    });

    update();
  }

  /**
   * @private
   * @param {import('../../domain/Timetable.js').Timetable} timetable
   */
  _openExportDialog(timetable) {
    const payload = { schoolData: this.schoolData, timetable };
    const formats = this.context.transfer.listExporters(payload);

    const mode = selectField({
      label: 'PDF layout',
      options: [
        { value: 'byClass', label: 'One page per class' },
        { value: 'byTeacher', label: 'One page per teacher' },
      ],
      help: 'Only affects the PDF. Excel always contains the full week for every class.',
    });

    this.context.modals.open({
      title: 'Export timetable',
      size: 'narrow',
      body: el('div', { class: 'u-stack' }, [
        mode.wrapper,
        ...formats.map((format) => el('button', {
          class: 'quick-action',
          disabled: !format.available,
          on: {
            click: async () => {
              const result = await this.context.transfer.runExport(format.id, {
                ...payload,
                options: { mode: mode.select.value },
              });
              this.reportResult(result, `Exported as ${format.label}.`);
            },
          },
        }, [
          el('span', { class: 'quick-action__icon', text: '⇧', attrs: { 'aria-hidden': 'true' } }),
          el('span', {}, [
            el('span', { class: 'quick-action__label', text: format.label }),
            el('span', {
              class: 'quick-action__desc',
              text: format.available ? format.description : 'Not available — the library did not load.',
            }),
          ]),
        ])),
        helpHint('Tip: the Print button uses your browser\'s own "Save as PDF", which always works even if the PDF library is blocked.'),
      ]),
      actions: [{ label: 'Close' }],
    });
  }

  /**
   * @private
   * @returns {Node}
   */
  _renderLegend() {
    const used = new Set(
      (this.context.repositories.timetables.getActive()?.lessons ?? []).map((lesson) => lesson.subjectId),
    );
    const subjects = this.schoolData.sortedSubjects.filter((subject) => used.has(subject.id));

    return el('div', { class: 'tt-legend' }, [
      ...subjects.map((subject) => el('span', { class: 'tt-legend__item' }, [
        el('span', { class: 'tt-legend__swatch', style: { '--subject-fill': subject.fillVar } }),
        el('span', { text: `${subject.shortName} — ${subject.name}` }),
      ])),
      subjects.length > 0 && el('span', {
        class: 'tt-legend__item u-muted no-print',
        text: '· Drag a period to move it, drop it on another to swap, click it to change the teacher or pin it.',
      }),
    ]);
  }
}
