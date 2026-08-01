/**
 * @file TimeConfigView.js
 * @description Defines the school day: working days, period length, start time
 * and breaks.
 *
 * Changing anything here re-shapes the grid every timetable is built on, so the
 * screen shows a live preview of the resulting day before the user commits, and
 * warns plainly that periods falling outside a shortened day will be dropped.
 */

import { View } from '../View.js';
import { Settings } from '../../domain/Settings.js';
import { el, replaceChildren } from '../../utils/DomUtils.js';
import { textField, numberField, checkboxField, helpHint } from '../components/FormField.js';
import { TimeGrid } from '../../domain/TimeGrid.js';
import { Events, LIMITS } from '../../utils/Constants.js';
import { formatDuration } from '../../utils/TimeUtils.js';

/** Days offered by the day toggles, in week order. */
const ALL_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export class TimeConfigView extends View {
  /** @returns {string} */
  get title() { return 'Time Configuration'; }

  /** @override */
  constructor(context, params) {
    super(context, params);
    /** @private @type {Settings} Working copy; nothing is saved until Save. */
    this._draft = new Settings(this.schoolData.settings.toJSON());
  }

  /** @override */
  onMount() {
    this.subscribe(Events.SETTINGS_CHANGED, () => {
      this._draft = new Settings(this.schoolData.settings.toJSON());
      this.refresh();
    });
  }

  /** @returns {Node} */
  render() {
    /** @private */ this._previewSlot = el('div');
    this._renderPreview();

    return el('div', { class: 'view' }, [
      el('header', { class: 'view-header' }, [
        el('div', { class: 'view-header__text' }, [
          el('h1', { text: 'Time Configuration' }),
          el('p', {
            class: 'u-secondary u-small',
            text: 'The shape of the school day. Every timetable is built on this grid.',
          }),
        ]),
        el('div', { class: 'view-header__actions' }, [
          el('button', { class: 'button', text: 'Reset changes', on: { click: () => this._reset() } }),
          el('button', { class: 'button button--primary', text: 'Save school day', on: { click: () => this._save() } }),
        ]),
      ]),

      el('div', { class: 'generate-layout' }, [
        el('div', { class: 'u-stack' }, [
          this._renderSchoolCard(),
          this._renderDayCard(),
          this._renderBreaksCard(),
          this._renderCoreWindowCard(),
        ]),
        el('section', { class: 'card' }, [
          el('div', { class: 'card__header' }, [el('h2', { text: 'Preview' })]),
          el('div', { class: 'card__body' }, [this._previewSlot]),
        ]),
      ]),
    ]);
  }

  /**
   * @private
   * @returns {Node}
   */
  _renderSchoolCard() {
    const name = textField({
      label: 'School name',
      value: this._draft.school.name,
      help: 'Appears at the top of every exported timetable and PDF.',
    });
    const year = textField({
      label: 'Academic year',
      value: this._draft.school.academicYear,
      placeholder: '2026-27',
    });

    name.input.addEventListener('input', () => {
      this._draft = this._draft.withChanges({ school: { ...this._draft.school, name: name.input.value } });
    });
    year.input.addEventListener('input', () => {
      this._draft = this._draft.withChanges({ school: { ...this._draft.school, academicYear: year.input.value } });
    });

    return el('section', { class: 'card' }, [
      el('div', { class: 'card__header' }, [el('h2', { text: 'School' })]),
      el('div', { class: 'card__body' }, [
        el('div', { class: 'form-grid' }, [name.wrapper, year.wrapper]),
      ]),
    ]);
  }

  /**
   * @private
   * @returns {Node}
   */
  _renderDayCard() {
    const chosen = new Set(this._draft.workingDays);

    const dayToggles = el('div', { class: 'day-toggle-list' }, ALL_DAYS.map((day) => {
      const button = el('button', {
        class: 'day-toggle',
        type: 'button',
        text: day,
        attrs: { 'aria-pressed': chosen.has(day) ? 'true' : 'false' },
        on: {
          click: () => {
            if (chosen.has(day)) chosen.delete(day);
            else chosen.add(day);
            button.setAttribute('aria-pressed', chosen.has(day) ? 'true' : 'false');
            // Preserve week order rather than click order, so Sat never sorts
            // before Mon in the grid.
            this._update({ workingDays: ALL_DAYS.filter((item) => chosen.has(item)) });
          },
        },
      });
      return button;
    }));

    const start = textField({
      label: 'First period starts at',
      value: this._draft.dayStart,
      placeholder: '08:00',
      help: 'Use 24-hour time. Example: 08:00. Every other period time is calculated from this.',
    });
    start.input.addEventListener('input', () => this._update({ dayStart: start.input.value }));

    const duration = numberField({
      label: 'Length of one period (minutes)',
      value: this._draft.periodDurationMinutes,
      min: 5,
      max: 180,
      step: 5,
      help: 'Example: 40 gives periods of 08:00–08:40, 08:40–09:20, and so on.',
    });
    duration.input.addEventListener('input', () => this._update({ periodDurationMinutes: Number(duration.input.value) }));

    const count = numberField({
      label: 'Teaching periods per day',
      value: this._draft.periodCount,
      min: LIMITS.MIN_PERIODS,
      max: LIMITS.MAX_PERIODS,
      help: 'Breaks are not counted here. Example: 8 periods with one recess makes a 9-row day.',
    });
    count.input.addEventListener('input', () => this._update({ periodCount: Number(count.input.value) }));

    return el('section', { class: 'card' }, [
      el('div', { class: 'card__header' }, [el('h2', { text: 'The day' })]),
      el('div', { class: 'card__body u-stack' }, [
        el('div', { class: 'field' }, [
          el('span', { class: 'field__label', text: 'Working days' }),
          dayToggles,
          helpHint('Tick the days your school runs. Example: turning off Saturday drops the week from 48 periods to 40 for every class — check the Curriculum screen afterwards for classes that no longer fit.'),
        ]),
        el('div', { class: 'form-grid' }, [start.wrapper, duration.wrapper, count.wrapper]),
      ]),
    ]);
  }

  /**
   * @private
   * @returns {Node}
   */
  _renderBreaksCard() {
    const rows = this._draft.breaks.map((item, index) => {
      const after = numberField({
        label: 'After period',
        value: item.afterPeriod,
        min: 1,
        max: Math.max(1, this._draft.periodCount - 1),
      });
      const label = textField({ label: 'Name', value: item.label });
      const minutes = numberField({ label: 'Minutes', value: item.durationMinutes, min: 1, max: 120, step: 5 });
      const isRecess = checkboxField({
        label: 'This is the recess',
        checked: item.isRecess,
        help: 'The recess is the dividing line for "before recess" and "after recess" subject preferences. Only one break can be the recess.',
      });

      const apply = () => {
        const next = this._draft.breaks.map((entry, position) => (position === index ? {
          afterPeriod: Number(after.input.value),
          label: label.input.value,
          durationMinutes: Number(minutes.input.value),
          isRecess: /** @type {HTMLInputElement} */ (isRecess.input).checked,
        } : entry));
        this._update({ breaks: next });
      };

      for (const control of [after.input, label.input, minutes.input, isRecess.input]) {
        control.addEventListener('input', apply);
        control.addEventListener('change', apply);
      }

      return el('div', { class: 'card', style: { boxShadow: 'none' } }, [
        el('div', { class: 'card__body' }, [
          el('div', { class: 'form-grid' }, [label.wrapper, after.wrapper, minutes.wrapper]),
          isRecess.wrapper,
          el('div', { class: 'u-row', style: { marginTop: 'var(--space-3)' } }, [
            el('span', { class: 'u-spacer' }),
            el('button', {
              class: 'button button--small button--ghost',
              text: 'Remove this break',
              on: {
                click: () => this._update({
                  breaks: this._draft.breaks.filter((_, position) => position !== index),
                }, /* rerender */ true),
              },
            }),
          ]),
        ]),
      ]);
    });

    return el('section', { class: 'card' }, [
      el('div', { class: 'card__header' }, [
        el('h2', { text: 'Breaks' }),
        el('span', { class: 'u-spacer' }),
        el('button', {
          class: 'button button--small',
          text: 'Add break',
          on: {
            click: () => this._update({
              breaks: [...this._draft.breaks, {
                afterPeriod: Math.min(this._draft.periodCount - 1, this._draft.breaks.length + 2),
                label: 'Break',
                durationMinutes: 10,
                isRecess: this._draft.breaks.length === 0,
              }],
            }, /* rerender */ true),
          },
        }),
      ]),
      el('div', { class: 'card__body u-stack' }, rows.length > 0 ? rows : [
        el('p', { class: 'u-muted u-small', text: 'No breaks. The day runs straight through.' }),
      ]),
    ]);
  }

  /**
   * @private
   * @returns {Node}
   */
  _renderCoreWindowCard() {
    const from = numberField({
      label: 'From period',
      value: this._draft.corePeriodWindow.from,
      min: 1,
      max: this._draft.periodCount,
    });
    const to = numberField({
      label: 'To period',
      value: this._draft.corePeriodWindow.to,
      min: 1,
      max: this._draft.periodCount,
    });

    const apply = () => this._update({
      corePeriodWindow: { from: Number(from.input.value), to: Number(to.input.value) },
    });
    from.input.addEventListener('input', apply);
    to.input.addEventListener('input', apply);

    return el('section', { class: 'card' }, [
      el('div', { class: 'card__header' }, [el('h2', { text: 'Main subject window' })]),
      el('div', { class: 'card__body' }, [
        el('div', { class: 'form-grid' }, [from.wrapper, to.wrapper]),
        helpHint('Subjects marked "Main subject" on the Curriculum screen are pulled into these periods, and electives are pushed out of them. Example: with 1 to 6, a class gets Maths, Science and English in periods 1–6 and Library or PE in periods 7–8. This is a strong preference, not an absolute rule — if there are more main periods than the window holds, the extras still get scheduled rather than being dropped.'),
      ]),
    ]);
  }

  /**
   * Rebuilds the preview from the draft, showing exactly what the day will
   * look like — including whether the settings are even valid.
   * @private
   */
  _renderPreview() {
    const validation = this._draft.validate();

    if (!validation.ok) {
      replaceChildren(this._previewSlot, [
        el('div', { class: 'alert alert--danger' }, [
          el('span', { class: 'alert__icon', text: '!' }),
          el('div', { class: 'alert__body' }, [
            el('div', { text: 'These settings cannot be used yet:' }),
            el('ul', { style: { margin: 'var(--space-2) 0 0 var(--space-4)' } },
              validation.errors.map((error) => el('li', { text: error }))),
          ]),
        ]),
      ]);
      return;
    }

    const grid = TimeGrid.build(this._draft);
    const totalMinutes = this._draft.periodCount * this._draft.periodDurationMinutes
      + this._draft.breaks.reduce((sum, item) => sum + item.durationMinutes, 0);

    const rows = grid.getTimeline().map((entry) => (entry.type === 'break'
      ? el('div', { class: 'period-row period-row--break' }, [
        el('span', { class: 'period-row__index', text: '⏸' }),
        el('span', { text: entry.label }),
        el('span', { class: 'period-row__time', text: `${entry.startTime}–${entry.endTime}` }),
        el('span', { class: 'chip', text: entry.isRecess ? 'recess' : 'break' }),
      ])
      : el('div', { class: 'period-row' }, [
        el('span', { class: 'period-row__index', text: String(entry.periodIndex + 1) }),
        el('span', { text: `Period ${entry.periodIndex + 1}` }),
        el('span', { class: 'period-row__time', text: `${entry.startTime}–${entry.endTime}` }),
        el('span', {
          class: 'chip',
          text: entry.periodIndex + 1 <= this._draft.corePeriodWindow.to
            && entry.periodIndex + 1 >= this._draft.corePeriodWindow.from ? 'main' : '',
        }),
      ])));

    const capacity = grid.slotCount;
    const worstClass = this.schoolData.sortedClasses
      .map((item) => ({ name: item.name, demand: this.schoolData.demandForClass(item.id) }))
      .sort((a, b) => b.demand - a.demand)[0];

    replaceChildren(this._previewSlot, [
      el('div', { class: 'u-stack' }, [
        el('div', { class: 'stat-grid' }, [
          el('div', { class: 'stat-card' }, [
            el('span', { class: 'stat-card__value', text: String(capacity) }),
            el('span', { class: 'stat-card__label', text: 'Periods per class per week' }),
            el('span', { class: 'stat-card__hint', text: `${grid.dayCount} days × ${grid.periodCount}` }),
          ]),
          el('div', { class: 'stat-card' }, [
            el('span', { class: 'stat-card__value', text: formatDuration(totalMinutes) }),
            el('span', { class: 'stat-card__label', text: 'School day' }),
            el('span', { class: 'stat-card__hint', text: `${this._draft.dayStart}–${this._draft.dayEnd}` }),
          ]),
        ]),

        worstClass && worstClass.demand > capacity && el('div', { class: 'alert alert--danger' }, [
          el('span', { class: 'alert__icon', text: '!' }),
          el('div', { class: 'alert__body', text: `${worstClass.name} needs ${worstClass.demand} periods a week but this day only provides ${capacity}.` }),
        ]),

        ...validation.warnings.map((warning) => el('div', { class: 'alert alert--warning' }, [
          el('span', { class: 'alert__icon', text: '?' }),
          el('div', { class: 'alert__body', text: warning }),
        ])),

        el('div', {}, rows),
      ]),
    ]);
  }

  /**
   * Applies a change to the draft and refreshes the preview.
   * @private
   * @param {object} changes
   * @param {boolean} [rerender] Full re-render, needed when controls change count.
   */
  _update(changes, rerender = false) {
    this._draft = this._draft.withChanges(changes);
    if (rerender) this.refresh();
    else this._renderPreview();
  }

  /** @private */
  _reset() {
    this._draft = new Settings(this.schoolData.settings.toJSON());
    this.refresh();
    this.toast('Changes discarded.', 'info');
  }

  /** @private */
  async _save() {
    const validation = this._draft.validate();
    if (!validation.ok) {
      this.toast(validation.errors.join(' '), 'danger');
      return;
    }

    const geometryChanged = this._draft.geometryHash !== this.schoolData.settings.geometryHash;
    if (geometryChanged && this.schoolData.timetables.size > 0) {
      const confirmed = await this.context.modals.confirm({
        title: 'Change the school day?',
        message: 'This changes the grid every existing timetable was built on.',
        detail: 'Periods that fall outside the new day are removed from all saved versions. Generate a fresh version afterwards to fill the gaps.',
        confirmLabel: 'Change it',
        variant: 'danger',
      });
      if (!confirmed) return;
    }

    const result = await this.context.repositories.settings.save(this._draft);
    this.reportResult(result, 'School day saved.');
    if (result.ok) this.refresh();
  }
}
