/**
 * @file Toaster.js
 * @description Transient notifications.
 *
 * Listens on the event bus as well as exposing a direct API, so services deep
 * in the data layer can report a storage failure without holding a reference to
 * the UI. That is the whole reason the event bus exists.
 */

import { el, on } from '../../utils/DomUtils.js';
import { Events, ToastLevel, LIMITS } from '../../utils/Constants.js';

/** Errors stay until dismissed; everything else fades. */
const STICKY_LEVELS = new Set([ToastLevel.DANGER]);

export class Toaster {
  /**
   * @param {object} deps
   * @param {HTMLElement} deps.root
   * @param {import('../../core/EventBus.js').EventBus} deps.eventBus
   */
  constructor({ root, eventBus }) {
    /** @private */ this._root = root;
    /** @private */ this._eventBus = eventBus;

    this._eventBus.on(Events.TOAST, ({ message, level }) => this.show(message, level));
  }

  /**
   * @param {string} message
   * @param {string} [level] One of {@link ToastLevel}.
   * @param {object} [options]
   * @param {number} [options.durationMs]
   */
  show(message, level = ToastLevel.INFO, { durationMs = LIMITS.TOAST_DURATION_MS } = {}) {
    if (!message) return;

    const toast = el('div', { class: `toast toast--${level}`, attrs: { role: 'status' } }, [
      el('div', { class: 'toast__body', text: message }),
      el('button', {
        class: 'toast__close',
        text: '×',
        attrs: { 'aria-label': 'Dismiss' },
        on: { click: () => this._dismiss(toast) },
      }),
    ]);

    this._root.appendChild(toast);

    if (!STICKY_LEVELS.has(level)) {
      const timer = setTimeout(() => this._dismiss(toast), durationMs);
      // Pausing on hover lets someone actually finish reading a long message.
      on(toast, 'mouseenter', () => clearTimeout(timer));
    }
  }

  /** @param {string} message */
  success(message) { this.show(message, ToastLevel.SUCCESS); }

  /** @param {string} message */
  warning(message) { this.show(message, ToastLevel.WARNING); }

  /** @param {string} message */
  error(message) { this.show(message, ToastLevel.DANGER); }

  /**
   * @private
   * @param {HTMLElement} toast
   */
  _dismiss(toast) {
    if (!toast.isConnected) return;
    toast.classList.add('toast--leaving');
    on(toast, 'animationend', () => toast.remove());
    // Belt and braces: if animations are disabled the animationend never fires.
    setTimeout(() => toast.remove(), 400);
  }

  /** Removes every visible toast. */
  clear() {
    this._root.replaceChildren();
  }
}
