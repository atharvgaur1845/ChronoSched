/**
 * @file Modal.js
 * @description Dialogs, with the accessibility work done once.
 *
 * A modal that does not trap focus is a modal a keyboard user can tab straight
 * out of, into a page they cannot see and should not be reaching. That, Escape
 * to close, restoring focus to whatever opened the dialog, and locking body
 * scroll are handled here so no caller has to remember them.
 *
 * `confirm()` returns a Promise, so destructive actions read as
 * `if (await confirm(...))` instead of nesting callbacks.
 */

import { el, on, clear } from '../../utils/DomUtils.js';

/** Selector for everything that can hold keyboard focus. */
const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])',
  'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(',');

export class ModalHost {
  /**
   * @param {HTMLElement} root
   */
  constructor(root) {
    /** @private */ this._root = root;
    /** @private @type {Array<{backdrop: HTMLElement, restoreFocus: Element|null, dispose: () => void}>} */
    this._stack = [];
  }

  /** @returns {boolean} */
  get isOpen() {
    return this._stack.length > 0;
  }

  /**
   * Opens a dialog.
   *
   * @param {object} config
   * @param {string} config.title
   * @param {Node|Node[]} config.body
   * @param {Array<{label: string, variant?: string, onClick?: (close: () => void) => void, closes?: boolean}>} [config.actions]
   * @param {'narrow'|'default'|'wide'} [config.size]
   * @param {boolean} [config.dismissable] Allow Escape and backdrop click.
   * @param {() => void} [config.onClose]
   * @returns {{close: () => void, element: HTMLElement}}
   */
  open({ title, body, actions = [], size = 'default', dismissable = true, onClose }) {
    const sizeClass = size === 'default' ? '' : ` modal--${size}`;

    const footer = actions.length > 0
      ? el('footer', { class: 'modal__footer' }, actions.map((action) => el('button', {
        class: `button ${action.variant ? `button--${action.variant}` : ''}`,
        text: action.label,
        on: {
          click: () => {
            action.onClick?.(close);
            if (action.closes !== false) close();
          },
        },
      })))
      : null;

    const dialog = el('div', {
      class: `modal${sizeClass}`,
      attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    }, [
      el('header', { class: 'modal__header' }, [
        el('h2', { class: 'modal__title', text: title }),
        dismissable && el('button', {
          class: 'icon-button',
          text: '×',
          attrs: { 'aria-label': 'Close' },
          on: { click: () => close() },
        }),
      ]),
      el('div', { class: 'modal__body' }, Array.isArray(body) ? body : [body]),
      footer,
    ]);

    const backdrop = el('div', { class: 'modal-backdrop' }, [dialog]);

    if (dismissable) {
      on(backdrop, 'mousedown', (event) => {
        if (event.target === backdrop) close();
      });
    }

    const restoreFocus = document.activeElement;
    const detachKeys = on(document, 'keydown', (event) => {
      if (!this._isTop(backdrop)) return;

      if (event.key === 'Escape' && dismissable) {
        event.preventDefault();
        close();
        return;
      }
      if (event.key === 'Tab') this._trapFocus(event, dialog);
    });

    const entry = { backdrop, restoreFocus, dispose: detachKeys };
    this._stack.push(entry);
    this._root.appendChild(backdrop);
    document.body.style.overflow = 'hidden';

    // Focus the first meaningful control, not the close button — the user is
    // here to do something, not to leave.
    //
    // Note the scoping: FOCUSABLE is a comma-separated selector list, so
    // `'.modal__body ' + FOCUSABLE` would only prefix the FIRST entry and the
    // rest would match anywhere in the dialog — which is how focus ended up on
    // the close button. Query the body element directly instead.
    const bodyElement = dialog.querySelector('.modal__body');
    const first = bodyElement?.querySelector(FOCUSABLE) ?? dialog.querySelector(FOCUSABLE);
    /** @type {HTMLElement|null} */ (first)?.focus();

    const self = this;
    function close() {
      self._close(entry, onClose);
    }

    return { close, element: dialog };
  }

  /**
   * A yes/no dialog.
   * @param {object} config
   * @param {string} config.title
   * @param {string} config.message
   * @param {string} [config.confirmLabel]
   * @param {string} [config.cancelLabel]
   * @param {string} [config.variant] Button variant, e.g. `'danger'`.
   * @param {string} [config.detail] Extra low-contrast explanation.
   * @returns {Promise<boolean>}
   */
  confirm({ title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', variant = 'primary', detail }) {
    return new Promise((resolve) => {
      let settled = false;
      const settle = (value) => { if (!settled) { settled = true; resolve(value); } };

      this.open({
        title,
        size: 'narrow',
        body: el('div', { class: 'u-stack' }, [
          el('p', { text: message }),
          detail && el('p', { class: 'help-hint', text: detail }),
        ]),
        actions: [
          { label: cancelLabel, onClick: () => settle(false) },
          { label: confirmLabel, variant, onClick: () => settle(true) },
        ],
        // Dismissing without choosing is a "no" — never a silent "yes".
        onClose: () => settle(false),
      });
    });
  }

  /**
   * A single-field prompt.
   * @param {object} config
   * @param {string} config.title
   * @param {string} config.label
   * @param {string} [config.value]
   * @param {string} [config.help]
   * @returns {Promise<string|null>} Null when cancelled.
   */
  prompt({ title, label, value = '', help }) {
    return new Promise((resolve) => {
      let settled = false;
      const settle = (result) => { if (!settled) { settled = true; resolve(result); } };

      const input = el('input', { class: 'input', type: 'text', value });

      const { close } = this.open({
        title,
        size: 'narrow',
        body: el('div', { class: 'field' }, [
          el('label', { class: 'field__label', text: label }),
          input,
          help && el('p', { class: 'help-hint', text: help }),
        ]),
        actions: [
          { label: 'Cancel', onClick: () => settle(null) },
          { label: 'Save', variant: 'primary', onClick: () => settle(input.value.trim()) },
        ],
        onClose: () => settle(null),
      });

      on(input, 'keydown', (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        settle(input.value.trim());
        close();
      });
      input.select();
    });
  }

  /** Closes every open dialog. */
  closeAll() {
    while (this._stack.length > 0) this._close(this._stack.at(-1));
  }

  /**
   * @private
   * @param {object} entry
   * @param {(() => void)} [onClose]
   */
  _close(entry, onClose) {
    const index = this._stack.indexOf(entry);
    if (index === -1) return;

    this._stack.splice(index, 1);
    entry.dispose();
    entry.backdrop.remove();

    if (this._stack.length === 0) {
      document.body.style.overflow = '';
      clear(this._root);
    }
    /** @type {HTMLElement|null} */ (entry.restoreFocus)?.focus?.();
    onClose?.();
  }

  /**
   * @private
   * @param {HTMLElement} backdrop
   * @returns {boolean}
   */
  _isTop(backdrop) {
    return this._stack.at(-1)?.backdrop === backdrop;
  }

  /**
   * Wraps Tab focus around inside the dialog.
   * @private
   * @param {KeyboardEvent} event
   * @param {HTMLElement} dialog
   */
  _trapFocus(event, dialog) {
    const focusable = [...dialog.querySelectorAll(FOCUSABLE)]
      .filter((node) => node instanceof HTMLElement && node.offsetParent !== null);
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable.at(-1);

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      /** @type {HTMLElement} */ (last).focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      /** @type {HTMLElement} */ (first).focus();
    }
  }
}
