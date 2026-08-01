/**
 * @file SettingsView.js
 * @description Theme, import, export, storage and data reset.
 *
 * The destructive actions live at the bottom behind confirmations that state
 * precisely what will be lost. "Are you sure?" is not a safety measure;
 * "this deletes 3 timetable versions and 54 curriculum rows" is.
 */

import { View } from '../View.js';
import { el, replaceChildren, pickFiles } from '../../utils/DomUtils.js';
import { helpHint, selectField } from '../components/FormField.js';
import { Events, Theme, STORAGE_PREFIX, Routes } from '../../utils/Constants.js';

export class SettingsView extends View {
  /** @returns {string} */
  get title() { return 'Settings'; }

  /** @override */
  onMount() {
    this.subscribeAll([Events.THEME_CHANGED, Events.DATA_READY], () => this.refresh());

    if (this.params.section) {
      queueMicrotask(() => {
        document.getElementById(`section-${this.params.section}`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
  }

  /** @returns {Node} */
  render() {
    return el('div', { class: 'view' }, [
      el('header', { class: 'view-header' }, [
        el('div', { class: 'view-header__text' }, [
          el('h1', { text: 'Settings' }),
          el('p', {
            class: 'u-secondary u-small',
            text: 'Appearance, moving data in and out, and storage. Everything stays on this computer.',
          }),
        ]),
      ]),
      this._renderAppearance(),
      this._renderImport(),
      this._renderExport(),
      this._renderStorage(),
      this._renderAbout(),
    ]);
  }

  // ------------------------------------------------------------- appearance

  /**
   * @private
   * @returns {Node}
   */
  _renderAppearance() {
    const theme = this.context.theme;

    const button = (label, value) => el('button', {
      class: 'button',
      text: label,
      attrs: {
        'aria-pressed': String(value === null ? !theme.isExplicit : theme.isExplicit && theme.current === value),
      },
      on: {
        click: () => {
          if (value === null) theme.followSystem();
          else theme.set(value);
          this.refresh();
        },
      },
    });

    return el('section', { class: 'card', attrs: { id: 'section-appearance' } }, [
      el('div', { class: 'card__header' }, [el('h2', { text: 'Appearance' })]),
      el('div', { class: 'card__body u-stack' }, [
        el('div', { class: 'button-group' }, [
          button('Light', Theme.LIGHT),
          button('Dark', Theme.DARK),
          button('Follow system', null),
        ]),
        helpHint(`Currently ${theme.current}${theme.isExplicit ? '' : ' (following your operating system)'}. The choice is remembered on this computer and applied before the page draws, so there is no white flash on a dark screen.`),
      ]),
    ]);
  }

  // ----------------------------------------------------------------- import

  /**
   * @private
   * @returns {Node}
   */
  _renderImport() {
    const preview = el('div');

    const dropzone = el('button', { class: 'dropzone', type: 'button' }, [
      el('span', { class: 'dropzone__icon', text: '⇩', attrs: { 'aria-hidden': 'true' } }),
      el('strong', { text: 'Choose a file, or drop one here' }),
      el('span', { class: 'u-small u-muted', text: 'Excel (.xlsx) for staff and curriculum · JSON for a full backup' }),
    ]);

    dropzone.addEventListener('click', async () => {
      const [file] = await pickFiles({ accept: this.context.transfer.acceptedFileTypes });
      if (file) this._previewImport(file, preview);
    });

    for (const type of ['dragenter', 'dragover']) {
      dropzone.addEventListener(type, (event) => {
        event.preventDefault();
        dropzone.classList.add('dropzone--active');
      });
    }
    for (const type of ['dragleave', 'drop']) {
      dropzone.addEventListener(type, (event) => {
        event.preventDefault();
        dropzone.classList.remove('dropzone--active');
      });
    }
    dropzone.addEventListener('drop', (event) => {
      const file = /** @type {DragEvent} */ (event).dataTransfer?.files?.[0];
      if (file) this._previewImport(file, preview);
    });

    return el('section', { class: 'card', attrs: { id: 'section-import' } }, [
      el('div', { class: 'card__header' }, [el('h2', { text: 'Import' })]),
      el('div', { class: 'card__body u-stack' }, [
        dropzone,
        helpHint('Nothing is saved until you review what was read and confirm. Excel files are merged — rows matching an existing teacher, class or subject by name update it rather than creating a duplicate, and anything not in the file is left alone. A JSON backup replaces everything.'),
        preview,
      ]),
    ]);
  }

  /**
   * @private
   * @param {File} file
   * @param {HTMLElement} host
   */
  async _previewImport(file, host) {
    replaceChildren(host, [el('div', { class: 'u-row' }, [
      el('span', { class: 'spinner' }),
      el('span', { class: 'u-small', text: `Reading ${file.name}…` }),
    ])]);

    const result = await this.context.transfer.parseImport(file);
    if (!result.ok) {
      replaceChildren(host, [el('div', { class: 'alert alert--danger' }, [
        el('span', { class: 'alert__icon', text: '!' }),
        el('div', { class: 'alert__body', text: result.errors.join(' ') }),
      ])]);
      return;
    }

    replaceChildren(host, [result.value.format === 'json'
      ? this._renderJsonPreview(file, result.value)
      : this._renderExcelPreview(file, result.value)]);
  }

  /**
   * @private
   * @returns {Node}
   */
  _renderJsonPreview(file, { payload, summary }) {
    const current = this.schoolData.counts;

    return el('div', { class: 'u-stack' }, [
      el('div', { class: 'alert alert--warning' }, [
        el('span', { class: 'alert__icon', text: '!' }),
        el('div', { class: 'alert__body', text: 'A JSON backup REPLACES all current data, including every timetable version.' }),
      ]),
      el('div', { class: 'table-wrap' }, [
        el('table', { class: 'data-table' }, [
          el('thead', {}, [el('tr', {}, [
            el('th', { text: '' }), el('th', { text: 'Now' }), el('th', { text: 'After import' }),
          ])]),
          el('tbody', {}, Object.entries(summary).map(([key, value]) => el('tr', {}, [
            el('td', { text: key.charAt(0).toUpperCase() + key.slice(1) }),
            el('td', { class: 'data-table__num', text: String(current[key] ?? 0) }),
            el('td', { class: 'data-table__num', text: String(value) }),
          ]))),
        ]),
      ]),
      el('button', {
        class: 'button button--danger',
        text: `Replace everything with ${file.name}`,
        on: {
          click: async () => {
            const confirmed = await this.context.modals.confirm({
              title: 'Replace all data?',
              message: `Everything currently stored — ${current.teachers} teachers, ${current.curriculum} curriculum rows and ${current.timetables} timetable version(s) — will be discarded.`,
              detail: 'Export a backup first if you are not certain.',
              confirmLabel: 'Replace everything',
              variant: 'danger',
            });
            if (!confirmed) return;

            const outcome = await this.context.transfer.commitJsonImport(payload);
            this.reportResult(outcome, 'Data restored from the backup.');
            if (outcome.ok) this.context.router.navigate(Routes.DASHBOARD);
          },
        },
      }),
    ]);
  }

  /**
   * @private
   * @returns {Node}
   */
  _renderExcelPreview(file, { entities, problems, summary }) {
    const errors = problems.filter((item) => item.level === 'error');
    const warnings = problems.filter((item) => item.level === 'warning');

    return el('div', { class: 'u-stack' }, [
      el('div', { class: 'stat-grid' }, [
        this._count(summary.classes, 'Classes'),
        this._count(summary.subjects, 'Subjects'),
        this._count(summary.teachers, 'Teachers'),
        this._count(summary.curriculum, 'Curriculum rows'),
      ]),

      problems.length > 0 && el('div', { class: 'import-preview' }, [
        el('table', { class: 'data-table' }, [
          el('thead', {}, [el('tr', {}, [
            el('th', { text: 'Sheet' }), el('th', { text: 'Row' }), el('th', { text: 'Problem' }),
          ])]),
          el('tbody', {}, problems.slice(0, 100).map((problem) => el('tr', {
            class: problem.level === 'error' ? 'import-row--error' : 'import-row--warn',
          }, [
            el('td', { text: problem.sheet }),
            el('td', { class: 'data-table__num', text: String(problem.row) }),
            el('td', { text: problem.message }),
          ]))),
        ]),
      ]),

      helpHint(errors.length > 0
        ? `${errors.length} row(s) will be skipped and ${warnings.length} have warnings. Fix them in the spreadsheet and import again, or continue and add the missing pieces by hand.`
        : warnings.length > 0
          ? `${warnings.length} warning(s) — those rows will still be imported.`
          : 'No problems found.'),

      el('button', {
        class: 'button button--primary',
        text: `Import from ${file.name}`,
        disabled: summary.classes + summary.subjects + summary.teachers + summary.curriculum === 0,
        on: {
          click: async () => {
            const outcome = await this.context.transfer.commitExcelImport(entities);
            this.reportResult(outcome, 'Import complete.');
            if (outcome.ok) this.toast(outcome.value, 'success');
          },
        },
      }),
    ]);
  }

  /**
   * @private
   * @returns {Node}
   */
  _count(value, label) {
    return el('div', { class: 'stat-card' }, [
      el('span', { class: 'stat-card__value', text: String(value) }),
      el('span', { class: 'stat-card__label', text: label }),
    ]);
  }

  // ----------------------------------------------------------------- export

  /**
   * @private
   * @returns {Node}
   */
  _renderExport() {
    const timetable = this.context.repositories.timetables.getActive();
    const payload = { schoolData: this.schoolData, timetable };
    const formats = this.context.transfer.listExporters(payload);

    const mode = selectField({
      label: 'PDF layout',
      options: [
        { value: 'byClass', label: 'One page per class' },
        { value: 'byTeacher', label: 'One page per teacher' },
      ],
    });

    return el('section', { class: 'card', attrs: { id: 'section-export' } }, [
      el('div', { class: 'card__header' }, [el('h2', { text: 'Export' })]),
      el('div', { class: 'card__body u-stack' }, [
        mode.wrapper,
        el('div', { class: 'quick-actions' }, formats.map((format) => el('button', {
          class: 'quick-action',
          disabled: !format.available,
          on: {
            click: async () => {
              const result = await this.context.transfer.runExport(format.id, {
                ...payload, options: { mode: mode.select.value },
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
              text: format.available ? format.description
                : (format.id === 'pdf' && !timetable ? 'Generate a timetable first.' : 'Library unavailable.'),
            }),
          ]),
        ]))),
        helpHint('Export a JSON backup regularly. Browser storage can be cleared by a "clear browsing data" action or by the browser itself when disk space runs low, and a JSON file is the only complete copy.'),
      ]),
    ]);
  }

  // ---------------------------------------------------------------- storage

  /**
   * @private
   * @returns {Node}
   */
  _renderStorage() {
    const bytes = this.context.storage.estimateBytes(STORAGE_PREFIX);
    const counts = this.schoolData.counts;

    return el('section', { class: 'card', attrs: { id: 'section-storage' } }, [
      el('div', { class: 'card__header' }, [el('h2', { text: 'Storage' })]),
      el('div', { class: 'card__body u-stack' }, [
        !this.context.storage.isPersistent && el('div', { class: 'alert alert--danger' }, [
          el('span', { class: 'alert__icon', text: '!' }),
          el('div', { class: 'alert__body', text: 'This browser is blocking local storage (private browsing, most likely). Your changes exist only until this tab is closed. Export a JSON backup before you finish.' }),
        ]),

        el('div', { class: 'report-metric' }, [
          el('span', { class: 'u-secondary', text: 'Space used' }),
          el('span', { class: 'report-metric__value', text: `${(bytes / 1024).toFixed(1)} KB` }),
        ]),
        el('div', { class: 'report-metric' }, [
          el('span', { class: 'u-secondary', text: 'Timetable versions kept' }),
          el('span', { class: 'report-metric__value', text: String(counts.timetables) }),
        ]),

        el('div', { class: 'u-row' }, [
          el('button', {
            class: 'button',
            text: 'Restore demo school',
            on: { click: () => this._restoreDemo() },
          }),
          el('button', {
            class: 'button button--danger',
            text: 'Delete all data',
            on: { click: () => this._resetAll() },
          }),
        ]),
        helpHint('"Restore demo school" throws away your data and reloads the sample school that ships with the app — useful for training or trying things out. "Delete all data" leaves you with an empty app.'),
      ]),
    ]);
  }

  /** @private */
  async _restoreDemo() {
    const confirmed = await this.context.modals.confirm({
      title: 'Restore the demo school?',
      message: 'Your current teachers, classes, subjects, curriculum and every timetable version will be replaced with the sample data.',
      detail: 'Export a JSON backup first if you want to keep any of it.',
      confirmLabel: 'Restore demo data',
      variant: 'danger',
    });
    if (!confirmed) return;

    await this.context.dataService.restoreDemoData();
    this.toast('Demo school restored.', 'success');
    this.context.router.navigate(Routes.DASHBOARD);
  }

  /** @private */
  async _resetAll() {
    const counts = this.schoolData.counts;
    const confirmed = await this.context.modals.confirm({
      title: 'Delete everything?',
      message: `This removes ${counts.teachers} teachers, ${counts.classes} classes, ${counts.subjects} subjects, ${counts.curriculum} curriculum rows and ${counts.timetables} timetable version(s).`,
      detail: 'There is no undo for this. Export a JSON backup first if there is any doubt.',
      confirmLabel: 'Delete everything',
      variant: 'danger',
    });
    if (!confirmed) return;

    await this.context.dataService.resetToEmpty();
    this.context.history.clear();
    this.toast('All data deleted.', 'success');
    this.context.router.navigate(Routes.DASHBOARD);
  }

  // ------------------------------------------------------------------ about

  /**
   * @private
   * @returns {Node}
   */
  _renderAbout() {
    return el('section', { class: 'card' }, [
      el('div', { class: 'card__header' }, [el('h2', { text: 'About' })]),
      el('div', { class: 'card__body u-stack' }, [
        el('p', { class: 'u-small u-secondary', text: 'ChronoSched runs entirely in your browser. No account, no server, no data leaves this computer.' }),
        el('div', { class: 'report-metric' }, [
          el('span', { class: 'u-secondary', text: 'Data source' }),
          el('span', { class: 'report-metric__value', text: this.context.dataService.sourceName }),
        ]),
        el('h3', { text: 'Keyboard shortcuts' }),
        el('div', {}, [
          this._shortcut('Ctrl + Z', 'Undo the last timetable edit'),
          this._shortcut('Ctrl + Y', 'Redo'),
          this._shortcut('/', 'Jump to search'),
          this._shortcut('Ctrl + Shift + N', 'Add a new record on a management screen'),
        ]),
      ]),
    ]);
  }

  /**
   * @private
   * @param {string} keys
   * @param {string} description
   * @returns {Node}
   */
  _shortcut(keys, description) {
    return el('div', { class: 'report-metric' }, [
      el('span', { class: 'u-secondary', text: description }),
      el('span', { class: 'chip u-mono', text: keys }),
    ]);
  }
}
