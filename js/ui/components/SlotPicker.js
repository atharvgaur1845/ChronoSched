/**
 * @file SlotPicker.js
 * @description A week grid for choosing periods — used for a teacher's
 * unavailable and preferred-free times.
 *
 * A pair of text boxes ("Mon P1, Sat") would be faster to build and far worse
 * to use: the administrator has to remember the syntax, cannot see the shape of
 * the week, and gets no feedback when a typo silently drops a period. A grid
 * makes the answer visible.
 *
 * Clicking a day header toggles the whole day, which is the common case —
 * "Mrs Sharma does not come in on Saturdays".
 */

import { el } from '../../utils/DomUtils.js';

export class SlotPicker {
  /**
   * @param {object} config
   * @param {import('../../domain/TimeGrid.js').TimeGrid} config.timeGrid
   * @param {Array<{dayIndex: number, periodIndex: number|null}>} config.selected
   * @param {'block'|'prefer'} [config.mode] Only affects the colour used.
   */
  constructor({ timeGrid, selected, mode = 'block' }) {
    /** @private */ this._grid = timeGrid;
    /** @private */ this._mode = mode;
    /** @private @type {Set<string>} `day:period`, or `day:*` for a whole day. */
    this._selected = new Set();

    for (const slot of selected ?? []) {
      this._selected.add(SlotPicker._key(slot.dayIndex, slot.periodIndex));
    }
  }

  /**
   * @private
   * @param {number} dayIndex
   * @param {number|null} periodIndex
   * @returns {string}
   */
  static _key(dayIndex, periodIndex) {
    return `${dayIndex}:${periodIndex === null ? '*' : periodIndex}`;
  }

  /**
   * Builds the grid.
   * @returns {HTMLElement}
   */
  render() {
    const days = this._grid.days;
    const periodCount = this._grid.periodCount;

    const container = el('div', {
      class: 'slot-picker',
      style: { 'grid-template-columns': `56px repeat(${periodCount}, minmax(34px, 1fr))` },
    });

    container.appendChild(el('div', { class: 'slot-picker__head', text: '' }));
    for (let period = 0; period < periodCount; period += 1) {
      container.appendChild(el('div', { class: 'slot-picker__head', text: `P${period + 1}` }));
    }

    for (const day of days) {
      container.appendChild(el('button', {
        class: 'slot-picker__head',
        type: 'button',
        text: day.label,
        attrs: { title: `Toggle the whole of ${day.label}` },
        on: { click: () => this._toggleDay(day.index, container) },
      }));

      for (let period = 0; period < periodCount; period += 1) {
        container.appendChild(this._renderCell(day.index, period));
      }
    }

    return container;
  }

  /**
   * @private
   * @param {number} dayIndex
   * @param {number} periodIndex
   * @returns {HTMLElement}
   */
  _renderCell(dayIndex, periodIndex) {
    const cell = el('button', {
      class: 'slot-picker__cell',
      type: 'button',
      text: '',
      dataset: { mode: this._mode, day: dayIndex, period: periodIndex },
      attrs: {
        'aria-pressed': this._isSelected(dayIndex, periodIndex) ? 'true' : 'false',
        'aria-label': `${this._grid.days[dayIndex].label} period ${periodIndex + 1}`,
      },
      on: {
        click: () => {
          this._toggleSlot(dayIndex, periodIndex);
          cell.setAttribute('aria-pressed', this._isSelected(dayIndex, periodIndex) ? 'true' : 'false');
        },
      },
    });
    return cell;
  }

  /**
   * @private
   * @param {number} dayIndex
   * @param {number} periodIndex
   * @returns {boolean}
   */
  _isSelected(dayIndex, periodIndex) {
    return this._selected.has(SlotPicker._key(dayIndex, null))
      || this._selected.has(SlotPicker._key(dayIndex, periodIndex));
  }

  /**
   * @private
   * @param {number} dayIndex
   * @param {number} periodIndex
   */
  _toggleSlot(dayIndex, periodIndex) {
    const wholeDay = SlotPicker._key(dayIndex, null);

    // Un-ticking one period of a whole-day selection expands it into the
    // individual periods first, so the click does what the user expects rather
    // than appearing to do nothing.
    if (this._selected.has(wholeDay)) {
      this._selected.delete(wholeDay);
      for (let period = 0; period < this._grid.periodCount; period += 1) {
        if (period !== periodIndex) this._selected.add(SlotPicker._key(dayIndex, period));
      }
      return;
    }

    const key = SlotPicker._key(dayIndex, periodIndex);
    if (this._selected.has(key)) this._selected.delete(key);
    else this._selected.add(key);
  }

  /**
   * @private
   * @param {number} dayIndex
   * @param {HTMLElement} container
   */
  _toggleDay(dayIndex, container) {
    const wholeDay = SlotPicker._key(dayIndex, null);
    const isFullySelected = this._selected.has(wholeDay)
      || Array.from({ length: this._grid.periodCount })
        .every((_, period) => this._selected.has(SlotPicker._key(dayIndex, period)));

    for (let period = 0; period < this._grid.periodCount; period += 1) {
      this._selected.delete(SlotPicker._key(dayIndex, period));
    }
    this._selected.delete(wholeDay);
    if (!isFullySelected) this._selected.add(wholeDay);

    for (const cell of container.querySelectorAll(`[data-day="${dayIndex}"]`)) {
      const period = Number(/** @type {HTMLElement} */ (cell).dataset.period);
      cell.setAttribute('aria-pressed', this._isSelected(dayIndex, period) ? 'true' : 'false');
    }
  }

  /**
   * Current selection in the persisted shape.
   *
   * Whole-day entries stay collapsed to `periodIndex: null` rather than being
   * expanded to eight rows, so the stored data keeps the administrator's
   * intent ("not in on Saturdays") and survives a change to the period count.
   *
   * @returns {Array<{dayIndex: number, periodIndex: number|null}>}
   */
  getSelection() {
    return [...this._selected].map((key) => {
      const [day, period] = key.split(':');
      return { dayIndex: Number(day), periodIndex: period === '*' ? null : Number(period) };
    }).sort((a, b) => a.dayIndex - b.dayIndex || (a.periodIndex ?? -1) - (b.periodIndex ?? -1));
  }

  /** @returns {number} Count of selected periods, treating a day as its periods. */
  get selectedCount() {
    let total = 0;
    for (const key of this._selected) {
      total += key.endsWith(':*') ? this._grid.periodCount : 1;
    }
    return total;
  }
}
