/**
 * @file ThemeManager.js
 * @description Owns the light/dark theme: applying it, persisting it, and
 * following the operating system when the user has expressed no preference.
 *
 * The theme is applied by stamping `data-theme` on `<html>`; every colour in
 * the app is a CSS custom property scoped to that attribute. No JavaScript
 * anywhere else touches a colour, which is why adding a third theme is one CSS
 * file and one entry in the Theme enum.
 *
 * A tiny inline script in index.html applies the stored theme before first
 * paint. That duplication is deliberate: waiting for this module to load would
 * show a white flash to every dark-mode user.
 */

import { Theme, Events } from '../utils/Constants.js';
import { createLogger } from '../utils/Logger.js';

const log = createLogger('ThemeManager');
const DARK_QUERY = '(prefers-color-scheme: dark)';

export class ThemeManager {
  /**
   * @param {object} deps
   * @param {import('../data/DataService.js').DataService} deps.dataService
   * @param {import('../core/EventBus.js').EventBus} deps.eventBus
   * @param {HTMLElement} [deps.root] Element carrying the data-theme attribute.
   */
  constructor({ dataService, eventBus, root = document.documentElement }) {
    /** @private */ this._dataService = dataService;
    /** @private */ this._eventBus = eventBus;
    /** @private */ this._root = root;
    /** @private @type {string|null} Null means "follow the system". */
    this._explicit = null;
    /** @private */ this._mediaQuery = window.matchMedia?.(DARK_QUERY) ?? null;
    /** @private @type {(() => void)|null} */
    this._detachSystemListener = null;
  }

  /**
   * Applies the stored preference, or the system setting when none is stored.
   * @param {object} preferences Already-loaded preference payload.
   */
  initialise(preferences = {}) {
    const stored = preferences.theme;
    this._explicit = stored === Theme.LIGHT || stored === Theme.DARK ? stored : null;
    this._apply(this.current, /* persist */ false);
    this._watchSystem();
    log.debug(`Theme initialised to "${this.current}"${this._explicit ? '' : ' (following system)'}.`);
  }

  /** @returns {string} The theme currently in effect. */
  get current() {
    return this._explicit ?? this.systemTheme;
  }

  /** @returns {string} What the operating system is asking for. */
  get systemTheme() {
    return this._mediaQuery?.matches ? Theme.DARK : Theme.LIGHT;
  }

  /** @returns {boolean} True when the user has chosen explicitly. */
  get isExplicit() {
    return this._explicit !== null;
  }

  /**
   * Sets and persists an explicit theme.
   * @param {string} theme One of {@link Theme}.
   */
  set(theme) {
    if (theme !== Theme.LIGHT && theme !== Theme.DARK) {
      log.warn(`Ignoring unknown theme "${theme}".`);
      return;
    }
    this._explicit = theme;
    this._apply(theme, /* persist */ true);
  }

  /** Flips between light and dark, becoming explicit in the process. */
  toggle() {
    this.set(this.current === Theme.DARK ? Theme.LIGHT : Theme.DARK);
  }

  /** Clears the explicit choice and returns to following the system. */
  followSystem() {
    this._explicit = null;
    this._apply(this.systemTheme, /* persist */ true);
  }

  /**
   * @private
   * @param {string} theme
   * @param {boolean} persist
   */
  _apply(theme, persist) {
    this._root.setAttribute('data-theme', theme);
    this._eventBus.emit(Events.THEME_CHANGED, theme);

    if (persist) {
      // Fire-and-forget: a failed theme write must never block the UI.
      this._dataService.persistPreferences({ theme: this._explicit }).catch((error) => {
        log.warn('Could not save the theme preference.', error);
      });
    }
  }

  /**
   * Follows OS changes, but only while the user has not chosen explicitly —
   * overriding a deliberate choice because the laptop switched to night mode
   * would be a bug, not a feature.
   * @private
   */
  _watchSystem() {
    if (!this._mediaQuery?.addEventListener) return;

    const listener = () => {
      if (this._explicit === null) this._apply(this.systemTheme, /* persist */ false);
    };
    this._mediaQuery.addEventListener('change', listener);
    this._detachSystemListener = () => this._mediaQuery.removeEventListener('change', listener);
  }

  /** Releases the system listener. */
  dispose() {
    this._detachSystemListener?.();
    this._detachSystemListener = null;
  }
}
