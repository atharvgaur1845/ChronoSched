/**
 * @file AppShell.js
 * @description The persistent frame: navigation, theme toggle, status bar and
 * the undo/redo controls.
 *
 * Everything here lives outside the router's outlet and survives navigation,
 * so it is wired once at startup rather than by each view. The navigation list
 * is generated from the router's own route table — a route added there appears
 * in the sidebar automatically, and there is no second list to forget.
 */

import { el, replaceChildren, on } from '../utils/DomUtils.js';
import { Events } from '../utils/Constants.js';

export class AppShell {
  /**
   * @param {object} deps
   * @param {import('./AppContext.js').AppContext} deps.context
   * @param {import('./Router.js').Router} deps.router
   */
  constructor({ context, router }) {
    /** @private */ this._context = context;
    /** @private */ this._router = router;

    /** @private */ this._shell = /** @type {HTMLElement} */ (document.getElementById('app-shell'));
    /** @private */ this._nav = /** @type {HTMLElement} */ (document.getElementById('app-nav'));
    /** @private */ this._navToggle = /** @type {HTMLElement} */ (document.getElementById('nav-toggle'));
    /** @private */ this._themeToggle = /** @type {HTMLElement} */ (document.getElementById('theme-toggle'));
    /** @private */ this._status = /** @type {HTMLElement} */ (document.getElementById('status-message'));
    /** @private */ this._storageNote = /** @type {HTMLElement} */ (document.getElementById('status-storage'));
    /** @private */ this._undoButton = /** @type {HTMLButtonElement} */ (document.getElementById('undo-button'));
    /** @private */ this._redoButton = /** @type {HTMLButtonElement} */ (document.getElementById('redo-button'));

    /** @private @type {number|undefined} */ this._statusTimer = undefined;
  }

  /** Wires every persistent control. */
  initialise() {
    this._buildNavigation();
    this._wireNavToggle();
    this._wireTheme();
    this._wireHistory();
    this._wireStatus();

    this._context.setStatus = (message, tone) => this.setStatus(message, tone);
    this._storageNote.textContent = this._context.storage.isPersistent
      ? 'Saved on this computer'
      : 'Not saved — storage blocked';
  }

  /**
   * Builds the sidebar from the router's route table.
   * @private
   */
  _buildNavigation() {
    const routes = this._router.navigationRoutes;

    replaceChildren(this._nav, [
      el('div', { class: 'nav-group-label', text: 'Overview' }),
      ...routes.filter((route) => route.group === 'overview').map((route) => this._navItem(route)),
      el('div', { class: 'nav-group-label', text: 'School data' }),
      ...routes.filter((route) => route.group === 'data').map((route) => this._navItem(route)),
      el('div', { class: 'nav-group-label', text: 'Timetable' }),
      ...routes.filter((route) => route.group === 'timetable').map((route) => this._navItem(route)),
    ]);

    this._syncActive(window.location.hash);
    this._context.eventBus.on(Events.NAVIGATE, ({ path }) => {
      this._syncActive(path);
      this._closeNav();
      this._refreshBadges();
    });

    // Counts in the sidebar are a cheap, always-visible sanity check.
    this._context.eventBus.on(Events.DATA_READY, () => this._refreshBadges());
    for (const event of [Events.TEACHERS_CHANGED, Events.CLASSES_CHANGED, Events.SUBJECTS_CHANGED,
      Events.CURRICULUM_CHANGED, Events.TIMETABLES_CHANGED]) {
      this._context.eventBus.on(event, () => this._refreshBadges());
    }
    this._refreshBadges();
  }

  /**
   * @private
   * @param {import('./Router.js').RouteDefinition} route
   * @returns {HTMLElement}
   */
  _navItem(route) {
    return el('a', {
      class: 'nav-item',
      href: route.path,
      dataset: { path: route.path },
    }, [
      el('span', { class: 'nav-item__icon', text: route.icon, attrs: { 'aria-hidden': 'true' } }),
      el('span', { text: route.label }),
      route.badge && el('span', { class: 'nav-item__badge', dataset: { badge: route.path } }),
    ]);
  }

  /** @private */
  _refreshBadges() {
    for (const route of this._router.navigationRoutes) {
      if (!route.badge) continue;
      const node = this._nav.querySelector(`[data-badge="${route.path}"]`);
      if (node) node.textContent = String(route.badge(this._context) ?? '');
    }
  }

  /**
   * @private
   * @param {string} path
   */
  _syncActive(path) {
    const base = path.split('?')[0];
    for (const item of this._nav.querySelectorAll('.nav-item')) {
      const isActive = /** @type {HTMLElement} */ (item).dataset.path === base;
      if (isActive) item.setAttribute('aria-current', 'page');
      else item.removeAttribute('aria-current');
    }
  }

  /** @private */
  _wireNavToggle() {
    on(this._navToggle, 'click', () => {
      const open = this._shell.dataset.navOpen === 'true';
      this._shell.dataset.navOpen = String(!open);
      this._navToggle.setAttribute('aria-expanded', String(!open));
    });

    // Tapping the scrim closes the drawer. The scrim is a ::after pseudo
    // element, so the click lands on the shell itself outside the nav.
    on(this._shell, 'click', (event) => {
      if (this._shell.dataset.navOpen !== 'true') return;
      const target = /** @type {Node} */ (event.target);
      if (!this._nav.contains(target) && !this._navToggle.contains(target)) this._closeNav();
    });
  }

  /** @private */
  _closeNav() {
    this._shell.dataset.navOpen = 'false';
    this._navToggle.setAttribute('aria-expanded', 'false');
  }

  /** @private */
  _wireTheme() {
    on(this._themeToggle, 'click', () => this._context.theme.toggle());
    this._context.eventBus.on(Events.THEME_CHANGED, (theme) => {
      this._themeToggle.setAttribute('title', theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
    });
  }

  /** @private */
  _wireHistory() {
    on(this._undoButton, 'click', () => this._context.editor.undo());
    on(this._redoButton, 'click', () => this._context.editor.redo());

    this._context.shortcuts.register('ctrl+z', () => this._context.editor.undo());
    this._context.shortcuts.register('ctrl+y', () => this._context.editor.redo());
    // Ctrl+Shift+Z is the redo chord most editors also accept.
    this._context.shortcuts.register('ctrl+shift+z', () => this._context.editor.redo());

    this._context.eventBus.on(Events.HISTORY_CHANGED, (state) => {
      this._undoButton.disabled = !state.canUndo;
      this._redoButton.disabled = !state.canRedo;
      this._undoButton.title = state.canUndo ? `Undo: ${state.undoLabel} (Ctrl+Z)` : 'Nothing to undo';
      this._redoButton.title = state.canRedo ? `Redo: ${state.redoLabel} (Ctrl+Y)` : 'Nothing to redo';

      if (state.canUndo) this.setStatus(state.undoLabel ?? 'Edited');
    });
  }

  /** @private */
  _wireStatus() {
    this._context.eventBus.on(Events.STATUS, ({ message, tone }) => this.setStatus(message, tone));
  }

  /**
   * Writes to the status bar. Transient messages fade back to "Ready" so the
   * bar never shows something stale from five minutes ago.
   * @param {string} message
   * @param {'idle'|'busy'|'error'} [tone]
   */
  setStatus(message, tone = 'idle') {
    clearTimeout(this._statusTimer);

    this._status.textContent = message;
    this._status.classList.toggle('app-status__message--busy', tone === 'busy');
    this._status.classList.toggle('app-status__message--error', tone === 'error');

    if (tone === 'busy') return;
    this._statusTimer = setTimeout(() => {
      this._status.textContent = 'Ready';
      this._status.classList.remove('app-status__message--busy', 'app-status__message--error');
    }, 6000);
  }
}
