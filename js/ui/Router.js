/**
 * @file Router.js
 * @description Hash-based client-side routing.
 *
 * WHY HASH ROUTING AND NOT THE HISTORY API
 * GitHub Pages serves static files. With `history.pushState`, a refresh on
 * `/timetable` asks the server for a file that does not exist and returns 404.
 * The usual workaround — a `404.html` that redirects — is a hack that breaks
 * the back button and confuses search engines. `#/timetable` is never sent to
 * the server, so refresh, bookmarking and deep links all simply work.
 *
 * The router owns view lifecycle: it unmounts the outgoing view before mounting
 * the incoming one, which is what guarantees a view's subscriptions are always
 * released exactly once.
 */

import { Routes, Events } from '../utils/Constants.js';
import { createLogger } from '../utils/Logger.js';

const log = createLogger('Router');

/**
 * @typedef {object} RouteDefinition
 * @property {string} path      e.g. `'#/teachers'`.
 * @property {string} label     Navigation label.
 * @property {string} icon      Single character or emoji.
 * @property {new (context: *, params: object) => import('./View.js').View} view
 * @property {boolean} [inNav]  Whether it appears in the sidebar.
 * @property {(context: *) => (string|number|null)} [badge] Optional nav counter.
 */

export class Router {
  /**
   * @param {object} deps
   * @param {HTMLElement} deps.outlet
   * @param {import('./AppContext.js').AppContext} deps.context
   * @param {import('../core/EventBus.js').EventBus} deps.eventBus
   */
  constructor({ outlet, context, eventBus }) {
    /** @private */ this._outlet = outlet;
    /** @private */ this._context = context;
    /** @private */ this._eventBus = eventBus;
    /** @private @type {Map<string, RouteDefinition>} */ this._routes = new Map();
    /** @private @type {import('./View.js').View|null} */ this._current = null;
    /** @private @type {string} */ this._currentPath = '';
    /** @private */ this._fallback = Routes.DASHBOARD;
    /** @private @type {(() => void)|null} */ this._detach = null;
  }

  /**
   * @param {RouteDefinition} definition
   * @returns {this}
   */
  register(definition) {
    this._routes.set(definition.path, { inNav: true, ...definition });
    return this;
  }

  /**
   * @param {RouteDefinition[]} definitions
   * @returns {this}
   */
  registerAll(definitions) {
    for (const definition of definitions) this.register(definition);
    return this;
  }

  /** @returns {RouteDefinition[]} Routes that belong in the sidebar. */
  get navigationRoutes() {
    return [...this._routes.values()].filter((route) => route.inNav);
  }

  /** @returns {string} */
  get currentPath() {
    return this._currentPath;
  }

  /** Starts listening and renders the current URL. */
  start() {
    const listener = () => this._resolve();
    window.addEventListener('hashchange', listener);
    this._detach = () => window.removeEventListener('hashchange', listener);
    this._resolve();
  }

  /** Stops routing and unmounts the active view. */
  stop() {
    this._detach?.();
    this._detach = null;
    this._current?.unmount();
    this._current = null;
  }

  /**
   * Navigates programmatically.
   * @param {string} path
   * @param {object} [query] Appended as `?key=value` after the hash path.
   */
  navigate(path, query) {
    const target = query && Object.keys(query).length > 0
      ? `${path}?${new URLSearchParams(query)}`
      : path;

    if (window.location.hash === target) this._resolve();
    else window.location.hash = target;
  }

  /**
   * Re-runs the current route, discarding view state. Used after a data reset
   * where a stale view would be showing entities that no longer exist.
   */
  reload() {
    this._resolve(/* force */ true);
  }

  /**
   * @private
   * @param {boolean} [force]
   */
  _resolve(force = false) {
    const raw = window.location.hash || this._fallback;
    const [path, queryString = ''] = raw.split('?');
    const route = this._routes.get(path);

    if (!route) {
      log.warn(`Unknown route "${path}" — redirecting to the dashboard.`);
      window.location.hash = this._fallback;
      return;
    }

    const params = Object.fromEntries(new URLSearchParams(queryString));

    // Same route with the same parameters: let the view refresh itself rather
    // than tearing down and rebuilding, which would lose scroll and focus.
    const isSameTarget = !force
      && this._currentPath === raw
      && this._current !== null;
    if (isSameTarget) {
      this._current.refresh();
      return;
    }

    this._current?.unmount();

    try {
      const view = new route.view(this._context, params);
      view.mount(this._outlet);
      this._current = view;
      this._currentPath = raw;
      document.title = `${view.title} · ChronoSched`;
    } catch (error) {
      log.error(`Failed to mount "${path}".`, error);
      this._current = null;
      this._outlet.innerHTML = '';
      const message = document.createElement('div');
      message.className = 'alert alert--danger';
      message.textContent = `This screen could not be opened: ${error.message}`;
      this._outlet.appendChild(message);
    }

    this._eventBus.emit(Events.NAVIGATE, { path, params });
    this._outlet.scrollTop = 0;
  }
}
