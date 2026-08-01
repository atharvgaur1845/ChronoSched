/**
 * @file SearchBox.js
 * @description The global search field in the app bar.
 *
 * Debounced: keystrokes fire a search 150ms after typing stops rather than on
 * every character. The scan itself is fast, but rebuilding the results panel on
 * every keypress makes the input feel laggy on a slow device.
 *
 * Keyboard-first: `/` focuses it from anywhere, arrows move through results,
 * Enter opens, Escape closes. An administrator doing bulk edits should never
 * need the mouse to find a teacher.
 */

import { el, on, clear } from '../../utils/DomUtils.js';
import { EntityKind, Routes } from '../../utils/Constants.js';

const DEBOUNCE_MS = 150;

/** Which screen each result kind opens, and how it filters. */
const DESTINATION = {
  [EntityKind.TEACHER]: Routes.TEACHERS,
  [EntityKind.CLASS]: Routes.CLASSES,
  [EntityKind.SUBJECT]: Routes.SUBJECTS,
};

export class SearchBox {
  /**
   * @param {object} deps
   * @param {HTMLElement} deps.mount
   * @param {import('../../services/SearchService.js').SearchService} deps.searchService
   * @param {import('../Router.js').Router} deps.router
   * @param {import('../../managers/ShortcutManager.js').ShortcutManager} deps.shortcuts
   */
  constructor({ mount, searchService, router, shortcuts }) {
    /** @private */ this._mount = mount;
    /** @private */ this._search = searchService;
    /** @private */ this._router = router;

    /** @private @type {HTMLInputElement} */
    this._input = /** @type {HTMLInputElement} */ (el('input', {
      class: 'input',
      type: 'search',
      attrs: {
        placeholder: 'Search teacher, subject or class…',
        'aria-label': 'Search',
        autocomplete: 'off',
      },
    }));

    /** @private */ this._panel = el('div', { class: 'search-results u-hidden' });
    /** @private @type {number|undefined} */ this._timer = undefined;
    /** @private @type {HTMLElement[]} */ this._items = [];
    /** @private */ this._activeIndex = -1;

    this._build();
    shortcuts.register('/', () => this._input.focus());
  }

  /** @private */
  _build() {
    const box = el('div', { class: 'searchbox' }, [
      el('span', { class: 'searchbox__icon', text: '⌕', attrs: { 'aria-hidden': 'true' } }),
      this._input,
    ]);

    clear(this._mount);
    this._mount.append(box, this._panel);

    on(this._input, 'input', () => this._scheduleSearch());
    on(this._input, 'focus', () => { if (this._input.value.trim()) this._runSearch(); });
    on(this._input, 'keydown', (event) => this._onKeyDown(event));

    // Closing on outside click rather than on blur, so clicking a result still
    // registers — blur fires first and would tear the panel down mid-click.
    on(document, 'mousedown', (event) => {
      if (!this._mount.contains(/** @type {Node} */ (event.target))) this.close();
    });
  }

  /** @private */
  _scheduleSearch() {
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this._runSearch(), DEBOUNCE_MS);
  }

  /** @private */
  _runSearch() {
    const query = this._input.value.trim();
    if (query.length === 0) { this.close(); return; }

    const groups = this._search.search(query);
    clear(this._panel);
    this._items = [];
    this._activeIndex = -1;

    if (groups.length === 0) {
      this._panel.appendChild(el('div', {
        class: 'search-results__empty',
        text: `Nothing matches “${query}”.`,
      }));
      this._panel.classList.remove('u-hidden');
      return;
    }

    for (const group of groups) {
      const section = el('div', { class: 'search-results__group' }, [
        el('div', { class: 'search-results__label', text: group.label }),
      ]);

      for (const hit of group.hits) {
        const item = el('button', { class: 'search-result', type: 'button' }, [
          el('span', {}, [
            el('div', { text: hit.title }),
            el('div', { class: 'u-muted u-small', text: hit.subtitle }),
          ]),
          el('span', { class: 'search-result__meta', text: group.label.slice(0, -1) }),
        ]);
        on(item, 'click', () => this._open(hit));
        section.appendChild(item);
        this._items.push(item);
      }
      this._panel.appendChild(section);
    }

    this._panel.classList.remove('u-hidden');
  }

  /**
   * @private
   * @param {KeyboardEvent} event
   */
  _onKeyDown(event) {
    if (event.key === 'Escape') { this.close(); this._input.blur(); return; }
    if (this._items.length === 0) return;

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      this._activeIndex = (this._activeIndex + step + this._items.length) % this._items.length;
      this._items[this._activeIndex].focus();
      return;
    }
    if (event.key === 'Enter' && this._activeIndex === -1) {
      event.preventDefault();
      this._items[0].click();
    }
  }

  /**
   * @private
   * @param {{kind: string, id: string, title: string}} hit
   */
  _open(hit) {
    const route = DESTINATION[hit.kind];
    this.close();
    this._input.value = '';
    if (route) this._router.navigate(route, { focus: hit.id });
  }

  /** Hides the results panel. */
  close() {
    this._panel.classList.add('u-hidden');
    this._items = [];
    this._activeIndex = -1;
  }
}
