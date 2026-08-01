/**
 * @file DataTable.js
 * @description Sortable, filterable table used by every management screen.
 *
 * Row actions use ONE delegated listener on the tbody rather than N listeners
 * on N buttons. With 200 teachers that is the difference between 400 listeners
 * and one, and it means rows can be re-rendered without leaking handlers.
 */

import { el, delegate, fragment } from '../../utils/DomUtils.js';

/**
 * @typedef {object} ColumnDefinition
 * @property {string} key
 * @property {string} header
 * @property {(row: *) => (string|number|Node)} [render] Defaults to `row[key]`.
 * @property {(row: *) => (string|number)} [sortValue] Defaults to the raw value.
 * @property {boolean} [sortable]
 * @property {boolean} [numeric] Right-aligns and uses tabular figures.
 * @property {string} [width]
 */

/**
 * @typedef {object} RowAction
 * @property {string} id
 * @property {string} label
 * @property {string} [variant]
 * @property {(row: *) => void} onClick
 * @property {(row: *) => boolean} [visible]
 */

export class DataTable {
  /**
   * @param {object} config
   * @param {ColumnDefinition[]} config.columns
   * @param {RowAction[]} [config.actions]
   * @param {(row: *) => string} config.rowId
   * @param {string} [config.emptyTitle]
   * @param {string} [config.emptyMessage]
   * @param {string} [config.emptyIcon]
   * @param {string} [config.initialSortKey]
   */
  constructor({ columns, actions = [], rowId, emptyTitle = 'Nothing here yet', emptyMessage = '', emptyIcon = '—', initialSortKey = null }) {
    /** @private */ this._columns = columns;
    /** @private */ this._actions = actions;
    /** @private */ this._rowId = rowId;
    /** @private */ this._empty = { title: emptyTitle, message: emptyMessage, icon: emptyIcon };
    /** @private @type {string|null} */ this._sortKey = initialSortKey;
    /** @private */ this._sortAscending = true;
    /** @private @type {*[]} */ this._rows = [];
    /** @private @type {HTMLElement|null} */ this._root = null;
  }

  /**
   * Renders the table.
   * @param {*[]} rows
   * @returns {HTMLElement}
   */
  render(rows) {
    this._rows = rows;

    if (rows.length === 0) {
      this._root = el('div', { class: 'empty-state' }, [
        el('div', { class: 'empty-state__icon', text: this._empty.icon }),
        el('div', { class: 'empty-state__title', text: this._empty.title }),
        this._empty.message && el('p', { class: 'u-small', text: this._empty.message }),
      ]);
      return this._root;
    }

    const table = el('table', { class: 'data-table' }, [
      el('thead', {}, [el('tr', {}, [
        ...this._columns.map((column) => this._renderHeader(column)),
        this._actions.length > 0 && el('th', { class: 'u-right', text: '' }),
      ])]),
      this._renderBody(),
    ]);

    this._root = el('div', { class: 'table-wrap' }, [table]);
    return this._root;
  }

  /**
   * @private
   * @param {ColumnDefinition} column
   * @returns {HTMLElement}
   */
  _renderHeader(column) {
    const isSorted = this._sortKey === column.key;
    const indicator = isSorted ? (this._sortAscending ? ' ▲' : ' ▼') : '';

    const header = el('th', {
      class: column.numeric ? 'u-right' : '',
      style: column.width ? { width: column.width } : undefined,
      attrs: { scope: 'col', 'aria-sort': isSorted ? (this._sortAscending ? 'ascending' : 'descending') : 'none' },
    });

    if (column.sortable === false) {
      header.textContent = column.header;
      return header;
    }

    header.appendChild(el('button', {
      class: 'text-button',
      text: column.header + indicator,
      on: {
        click: () => {
          if (this._sortKey === column.key) this._sortAscending = !this._sortAscending;
          else { this._sortKey = column.key; this._sortAscending = true; }
          this._rerender();
        },
      },
    }));
    return header;
  }

  /**
   * @private
   * @returns {HTMLElement}
   */
  _renderBody() {
    const sorted = this._sorted();
    const body = el('tbody', {}, sorted.map((row) => this._renderRow(row)));

    if (this._actions.length > 0) {
      delegate(body, 'click', '[data-action]', (_event, target) => {
        const action = this._actions.find((item) => item.id === target.dataset.action);
        const row = this._rows.find((candidate) => this._rowId(candidate) === target.dataset.rowId);
        if (action && row) action.onClick(row);
      });
    }
    return body;
  }

  /**
   * @private
   * @param {*} row
   * @returns {HTMLElement}
   */
  _renderRow(row) {
    const id = this._rowId(row);

    const cells = this._columns.map((column) => {
      const content = column.render ? column.render(row) : row[column.key];
      const cell = el('td', { class: column.numeric ? 'data-table__num' : '' });

      if (content instanceof Node) cell.appendChild(content);
      else cell.textContent = content === null || content === undefined ? '—' : String(content);
      return cell;
    });

    if (this._actions.length > 0) {
      const visible = this._actions.filter((action) => action.visible?.(row) ?? true);
      cells.push(el('td', {}, [
        el('div', { class: 'data-table__actions' }, visible.map((action) => el('button', {
          class: `button button--small ${action.variant ? `button--${action.variant}` : 'button--ghost'}`,
          text: action.label,
          dataset: { action: action.id, rowId: id },
        }))),
      ]));
    }

    return el('tr', { dataset: { rowId: id } }, cells);
  }

  /**
   * @private
   * @returns {*[]}
   */
  _sorted() {
    if (!this._sortKey) return this._rows;

    const column = this._columns.find((item) => item.key === this._sortKey);
    if (!column) return this._rows;

    const valueOf = column.sortValue ?? ((row) => row[column.key]);
    const direction = this._sortAscending ? 1 : -1;

    return [...this._rows].sort((left, right) => {
      const a = valueOf(left);
      const b = valueOf(right);
      if (a === b) return 0;
      if (a === null || a === undefined) return 1;
      if (b === null || b === undefined) return -1;
      return (typeof a === 'number' && typeof b === 'number'
        ? a - b
        : String(a).localeCompare(String(b), undefined, { numeric: true })) * direction;
    });
  }

  /**
   * Re-renders in place after a sort, without the owning view knowing.
   * @private
   */
  _rerender() {
    if (!this._root?.isConnected) return;
    const replacement = this.render(this._rows);
    this._root.replaceWith(replacement);
    this._root = replacement;
  }
}

/**
 * Filters rows by a query across the given fields. Shared by the management
 * screens so their search boxes all behave identically.
 * @template T
 * @param {T[]} rows
 * @param {string} query
 * @param {(row: T) => string[]} fieldsOf
 * @returns {T[]}
 */
export function filterRows(rows, query, fieldsOf) {
  const needle = String(query ?? '').trim().toLowerCase();
  if (needle.length === 0) return rows;

  return rows.filter((row) => fieldsOf(row).some(
    (value) => String(value ?? '').toLowerCase().includes(needle),
  ));
}

/**
 * Renders a list of short labels as chips, collapsing a long tail.
 * @param {string[]} labels
 * @param {object} [options]
 * @param {number} [options.max]
 * @param {string} [options.variant]
 * @param {string} [options.emptyText]
 * @returns {Node}
 */
export function chipList(labels, { max = 4, variant = '', emptyText = '—' } = {}) {
  if (labels.length === 0) return el('span', { class: 'u-muted', text: emptyText });

  const shown = labels.slice(0, max);
  const hidden = labels.length - shown.length;

  return fragment([
    el('div', { class: 'chip-list' }, [
      ...shown.map((label) => el('span', { class: `chip ${variant ? `chip--${variant}` : ''}`, text: label })),
      hidden > 0 && el('span', {
        class: 'chip',
        text: `+${hidden}`,
        attrs: { title: labels.slice(max).join(', ') },
      }),
    ]),
  ]);
}
