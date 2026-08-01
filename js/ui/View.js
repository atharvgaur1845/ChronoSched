/**
 * @file View.js
 * @description Base class for every screen.
 *
 * Provides the one thing hand-rolled UI code reliably gets wrong: teardown.
 * `subscribe()` and `listen()` record their unsubscribe functions, and
 * `unmount()` runs all of them. Without that, navigating between screens ten
 * times leaves ten dead event handlers re-rendering detached DOM — a leak that
 * only shows up after a long session, which is exactly when it is hardest to
 * diagnose.
 *
 * Views are the ONLY layer allowed to touch the DOM, and they reach data
 * exclusively through the injected context. A view never calls `localStorage`,
 * never calls `fetch`, and never constructs a service.
 */

import { clear } from '../utils/DomUtils.js';

export class View {
  /**
   * @param {import('./AppContext.js').AppContext} context
   * @param {object} [params] Route parameters.
   */
  constructor(context, params = {}) {
    if (new.target === View) {
      throw new TypeError('View is abstract and cannot be instantiated directly.');
    }
    /** @protected */ this.context = context;
    /** @protected */ this.params = params;
    /** @protected @type {HTMLElement|null} */ this.container = null;
    /** @private @type {Array<() => void>} */ this._teardown = [];
    /** @private */ this._mounted = false;
  }

  /** @returns {string} Document title fragment for this screen. */
  get title() {
    return 'ChronoSched';
  }

  /** @returns {boolean} */
  get isMounted() {
    return this._mounted;
  }

  /**
   * Builds this view's DOM.
   * @abstract
   * @returns {Node}
   */
  render() {
    throw new Error(`${this.constructor.name} must implement render().`);
  }

  /** Hook called after the DOM is in the document. */
  onMount() {}

  /** Hook called before teardown runs. */
  onUnmount() {}

  /**
   * Renders into a container and runs the mount hook.
   * @param {HTMLElement} container
   */
  mount(container) {
    this.container = container;
    clear(container);
    container.appendChild(this.render());
    this._mounted = true;
    this.onMount();
  }

  /**
   * Re-renders in place, preserving scroll position so a table that refreshes
   * after an edit does not jump the user back to the top.
   */
  refresh() {
    if (!this.container || !this._mounted) return;

    const outlet = this.container;
    const scrollTop = outlet.scrollTop;
    clear(outlet);
    outlet.appendChild(this.render());
    outlet.scrollTop = scrollTop;
  }

  /**
   * Releases every subscription and listener this view registered.
   */
  unmount() {
    if (!this._mounted) return;
    this.onUnmount();

    for (const dispose of this._teardown.reverse()) {
      try { dispose(); } catch { /* a failing teardown must not block the rest */ }
    }
    this._teardown = [];

    if (this.container) clear(this.container);
    this.container = null;
    this._mounted = false;
  }

  /**
   * Subscribes to an application event for this view's lifetime.
   * @protected
   * @param {string} eventName
   * @param {(payload: *) => void} handler
   */
  subscribe(eventName, handler) {
    this._teardown.push(this.context.eventBus.on(eventName, handler));
  }

  /**
   * Subscribes to several events with the same handler — the common case of
   * "re-render whenever anything relevant changes".
   * @protected
   * @param {string[]} eventNames
   * @param {(payload: *) => void} handler
   */
  subscribeAll(eventNames, handler) {
    for (const eventName of eventNames) this.subscribe(eventName, handler);
  }

  /**
   * Registers a DOM listener for this view's lifetime.
   * @protected
   * @param {EventTarget} target
   * @param {string} type
   * @param {EventListener} handler
   * @param {AddEventListenerOptions} [options]
   */
  listen(target, type, handler, options) {
    target.addEventListener(type, handler, options);
    this._teardown.push(() => target.removeEventListener(type, handler, options));
  }

  /**
   * Registers a keyboard shortcut for this view's lifetime.
   * @protected
   * @param {string} combo
   * @param {(event: KeyboardEvent) => void} handler
   */
  shortcut(combo, handler) {
    this._teardown.push(this.context.shortcuts.register(combo, handler));
  }

  /**
   * Registers an arbitrary cleanup callback.
   * @protected
   * @param {() => void} dispose
   */
  onTeardown(dispose) {
    this._teardown.push(dispose);
  }

  /** @protected @returns {import('../domain/SchoolData.js').SchoolData} */
  get schoolData() {
    return this.context.dataService.schoolData;
  }

  /**
   * Shows a toast. Convenience so views do not each import the event name.
   * @protected
   * @param {string} message
   * @param {string} [level]
   */
  toast(message, level = 'info') {
    this.context.toaster.show(message, level);
  }

  /**
   * Reports a Result: error toast on failure, warnings surfaced on success.
   * Centralised so every screen handles outcomes the same way.
   * @protected
   * @param {import('../core/Result.js').Result} result
   * @param {string} [successMessage]
   * @returns {boolean} Whether the operation succeeded.
   */
  reportResult(result, successMessage) {
    if (!result.ok) {
      this.toast(result.errors.join(' '), 'danger');
      return false;
    }
    if (result.warnings.length > 0) this.toast(result.warnings.join(' '), 'warning');
    else if (successMessage) this.toast(successMessage, 'success');
    return true;
  }
}
