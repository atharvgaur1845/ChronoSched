/**
 * @file EventBus.js
 * @description Minimal synchronous publish/subscribe bus.
 *
 * WHY THIS EXISTS
 * Without it, every view would need a direct reference to every repository to
 * know when to re-render, producing an N×M web of couplings. With it, services
 * announce facts ("teachers changed") and views react. Neither side imports the
 * other. This is the Observer pattern and the reason the UI layer can be
 * rewritten or replaced without touching a single service.
 *
 * The bus is instantiated once in main.js and injected — it is deliberately NOT
 * a module-level singleton, because a global would make it untestable and would
 * violate the project's no-global-state rule.
 */

import { createLogger } from '../utils/Logger.js';

const log = createLogger('EventBus');

export class EventBus {
  constructor() {
    /**
     * @private
     * @type {Map<string, Set<Function>>}
     */
    this._listeners = new Map();
  }

  /**
   * Subscribes to an event.
   * @param {string} eventName
   * @param {(payload: *) => void} handler
   * @returns {() => void} Unsubscribe function — always keep it and call it on unmount.
   */
  on(eventName, handler) {
    if (typeof handler !== 'function') {
      throw new TypeError(`EventBus.on("${eventName}") requires a function handler.`);
    }
    let handlers = this._listeners.get(eventName);
    if (!handlers) {
      handlers = new Set();
      this._listeners.set(eventName, handlers);
    }
    handlers.add(handler);
    return () => this.off(eventName, handler);
  }

  /**
   * Subscribes for exactly one delivery.
   * @param {string} eventName
   * @param {(payload: *) => void} handler
   * @returns {() => void}
   */
  once(eventName, handler) {
    const unsubscribe = this.on(eventName, (payload) => {
      unsubscribe();
      handler(payload);
    });
    return unsubscribe;
  }

  /**
   * Removes a subscription.
   * @param {string} eventName
   * @param {Function} handler
   */
  off(eventName, handler) {
    const handlers = this._listeners.get(eventName);
    if (!handlers) return;
    handlers.delete(handler);
    if (handlers.size === 0) this._listeners.delete(eventName);
  }

  /**
   * Publishes an event to all current subscribers.
   *
   * Iterates a copy of the handler set so a handler that unsubscribes (or
   * subscribes) during dispatch cannot corrupt the iteration. A throwing
   * handler is logged and skipped rather than aborting delivery to the rest —
   * one broken view must not freeze the whole application.
   *
   * @param {string} eventName
   * @param {*} [payload]
   */
  emit(eventName, payload) {
    const handlers = this._listeners.get(eventName);
    if (!handlers || handlers.size === 0) return;

    for (const handler of [...handlers]) {
      try {
        handler(payload);
      } catch (error) {
        log.error(`Handler for "${eventName}" threw:`, error);
      }
    }
  }

  /**
   * Removes every subscription for an event, or all events when omitted.
   * @param {string} [eventName]
   */
  clear(eventName) {
    if (eventName === undefined) this._listeners.clear();
    else this._listeners.delete(eventName);
  }

  /**
   * Number of handlers registered for an event. Test/diagnostics helper.
   * @param {string} eventName
   * @returns {number}
   */
  listenerCount(eventName) {
    return this._listeners.get(eventName)?.size ?? 0;
  }
}
