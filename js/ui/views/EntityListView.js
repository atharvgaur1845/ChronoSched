/**
 * @file EntityListView.js
 * @description Abstract base for the four management screens.
 *
 * Teachers, Classes, Subjects and Curriculum are the same screen wearing
 * different clothes: a searchable table, an "Add" button, an edit dialog and a
 * confirmed delete. Written four times, they drift — one grows a confirmation
 * dialog the others lack, one forgets to report warnings. Written once as a
 * Template Method, a subclass supplies only what genuinely differs: its
 * repository, its columns, and its form.
 *
 * Subclasses MUST implement: `repository`, `entityLabel`, `columns`, `rows`,
 * `searchableFields`, `buildForm`, `readForm`.
 */

import { View } from '../View.js';
import { DataTable, filterRows } from '../components/DataTable.js';
import { el, on } from '../../utils/DomUtils.js';

export class EntityListView extends View {
  /**
   * @param {import('../AppContext.js').AppContext} context
   * @param {object} params
   */
  constructor(context, params) {
    super(context, params);
    /** @protected @type {string} */ this.query = '';
    /** @protected @type {DataTable|null} */ this.table = null;
  }

  // ------------------------------------------------------- subclass contract

  /** @abstract @returns {import('../../data/repositories/Repository.js').Repository} */
  get repository() { throw new Error(`${this.constructor.name} must implement get repository().`); }

  /** @abstract @returns {{singular: string, plural: string}} */
  get entityLabel() { throw new Error(`${this.constructor.name} must implement get entityLabel().`); }

  /** @abstract @returns {import('../components/DataTable.js').ColumnDefinition[]} */
  get columns() { throw new Error(`${this.constructor.name} must implement get columns().`); }

  /** @abstract @returns {*[]} Rows in display order. */
  rows() { throw new Error(`${this.constructor.name} must implement rows().`); }

  /**
   * @abstract
   * @param {*} _row
   * @returns {string[]} Values the local filter searches.
   */
  searchableFields(_row) { throw new Error(`${this.constructor.name} must implement searchableFields().`); }

  /**
   * Builds the edit dialog's body and stores whatever handles it needs.
   * @abstract
   * @param {*|null} _entity Null when adding.
   * @returns {Node}
   */
  buildForm(_entity) { throw new Error(`${this.constructor.name} must implement buildForm().`); }

  /**
   * Reads the dialog back into a domain entity.
   * @abstract
   * @param {*|null} _entity
   * @returns {*}
   */
  readForm(_entity) { throw new Error(`${this.constructor.name} must implement readForm().`); }

  /** Events that should trigger a re-render. Subclasses may widen this. */
  get changeEvents() { return []; }

  /** @returns {string} Guidance shown under the page title. */
  get intro() { return ''; }

  /** @returns {Node[]} Extra buttons for the header. */
  extraActions() { return []; }

  /** @returns {Node|null} Optional content between the header and the table. */
  renderAside() { return null; }

  /** @returns {{title: string, message: string, icon: string}} */
  get emptyState() {
    return {
      title: `No ${this.entityLabel.plural} yet`,
      message: `Use the “Add ${this.entityLabel.singular}” button to create the first one.`,
      icon: '＋',
    };
  }

  // ------------------------------------------------------------------ render

  /** @returns {Node} */
  render() {
    const rows = this.rows();
    const filtered = filterRows(rows, this.query, (row) => this.searchableFields(row));

    this.table = new DataTable({
      columns: this.columns,
      rowId: (row) => row.id,
      actions: [
        { id: 'edit', label: 'Edit', onClick: (row) => this.openEditor(row) },
        { id: 'delete', label: 'Delete', variant: 'ghost', onClick: (row) => this.confirmDelete(row) },
      ],
      emptyTitle: rows.length === 0 ? this.emptyState.title : 'No matches',
      emptyMessage: rows.length === 0 ? this.emptyState.message : `Nothing matches “${this.query}”.`,
      emptyIcon: rows.length === 0 ? this.emptyState.icon : '⌕',
    });

    const filterInput = el('input', {
      class: 'input',
      type: 'search',
      value: this.query,
      attrs: { placeholder: `Filter ${this.entityLabel.plural}…`, 'aria-label': `Filter ${this.entityLabel.plural}` },
    });
    on(filterInput, 'input', () => {
      this.query = /** @type {HTMLInputElement} */ (filterInput).value;
      this.refreshTable();
    });

    /** @private */ this._tableSlot = el('div', {}, [this.table.render(filtered)]);

    return el('div', { class: 'view' }, [
      el('header', { class: 'view-header' }, [
        el('div', { class: 'view-header__text' }, [
          el('h1', { text: this.title }),
          this.intro && el('p', { class: 'u-secondary u-small', text: this.intro }),
        ]),
        el('div', { class: 'view-header__actions' }, [
          ...this.extraActions(),
          el('button', {
            class: 'button button--primary',
            text: `Add ${this.entityLabel.singular}`,
            on: { click: () => this.openEditor(null) },
          }),
        ]),
      ]),

      this.renderAside(),

      el('section', { class: 'card' }, [
        el('div', { class: 'card__header' }, [
          el('h2', { text: `${filtered.length} ${filtered.length === 1 ? this.entityLabel.singular : this.entityLabel.plural}` }),
          el('div', { class: 'searchbox', style: { maxWidth: '260px' } }, [
            el('span', { class: 'searchbox__icon', text: '⌕', attrs: { 'aria-hidden': 'true' } }),
            filterInput,
          ]),
        ]),
        el('div', { class: 'card__body card__body--flush' }, [this._tableSlot]),
      ]),
    ]);
  }

  /** Re-renders only the table, so the filter box keeps focus and caret. */
  refreshTable() {
    if (!this._tableSlot || !this.table) return;
    const filtered = filterRows(this.rows(), this.query, (row) => this.searchableFields(row));
    this._tableSlot.replaceChildren(this.table.render(filtered));
  }

  /** @override */
  onMount() {
    this.subscribeAll(this.changeEvents, () => this.refresh());
    this.shortcut('ctrl+shift+n', () => this.openEditor(null));

    // Deep link from global search: open the record straight away.
    if (this.params.focus) {
      const target = this.repository.getById(this.params.focus);
      if (target) queueMicrotask(() => this.openEditor(target));
    }
  }

  /**
   * Opens the add/edit dialog.
   * @param {*|null} entity
   */
  openEditor(entity) {
    const isNew = entity === null;

    this.context.modals.open({
      title: isNew ? `Add ${this.entityLabel.singular}` : `Edit ${entity.displayName}`,
      size: this.editorSize ?? 'default',
      body: this.buildForm(entity),
      actions: [
        { label: 'Cancel' },
        {
          label: isNew ? 'Add' : 'Save changes',
          variant: 'primary',
          closes: false,
          onClick: async (close) => {
            const draft = this.readForm(entity);
            if (!draft) return;   // The subclass already reported why.

            const result = isNew
              ? await this.repository.add(draft)
              : await this.repository.update(draft);

            if (!result.ok) {
              this.toast(result.errors.join(' '), 'danger');
              return;
            }
            if (result.warnings.length > 0) this.toast(result.warnings.join(' '), 'warning');
            else this.toast(`${this.entityLabel.singular} ${isNew ? 'added' : 'saved'}.`, 'success');

            close();
            this.refresh();
          },
        },
      ],
    });
  }

  /**
   * Confirms and performs a delete.
   * @param {*} entity
   */
  async confirmDelete(entity) {
    const confirmed = await this.context.modals.confirm({
      title: `Delete ${entity.displayName}?`,
      message: `This removes ${entity.displayName} from the school data.`,
      detail: this.deleteWarning(entity),
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (!confirmed) return;

    const result = await this.repository.remove(entity.id);
    if (!result.ok) {
      // A blocked delete is a useful explanation, not a failure — show it in a
      // dialog rather than a toast that vanishes before it can be read.
      this.context.modals.open({
        title: 'Cannot delete yet',
        size: 'narrow',
        body: el('div', { class: 'alert alert--warning' }, [
          el('div', { class: 'alert__body', text: result.errors.join(' ') }),
        ]),
        actions: [{ label: 'Close', variant: 'primary' }],
      });
      return;
    }

    this.toast(`${entity.displayName} deleted.`, 'success');
    this.refresh();
  }

  /**
   * Extra sentence shown in the delete dialog.
   * @param {*} _entity
   * @returns {string}
   */
  deleteWarning(_entity) {
    return 'This cannot be undone with Ctrl+Z — it is a data change, not a timetable edit.';
  }
}
