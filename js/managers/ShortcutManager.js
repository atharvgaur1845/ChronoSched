/**
 * @file ShortcutManager.js
 * @description One keyboard listener for the whole application.
 *
 * Views registering their own `keydown` handlers is how an app ends up with
 * Ctrl+Z working on three screens and silently doing nothing on the fourth,
 * and with two handlers fighting over the same chord. Everything is registered
 * here instead, and unregistered automatically when a view unmounts.
 *
 * Typing guard: shortcuts are suppressed while focus is in a text field, so
 * Ctrl+Z inside a teacher's name box undoes the typing — the browser's own
 * behaviour — rather than reverting a timetable edit somewhere off-screen.
 */

import { createLogger } from '../utils/Logger.js';

const log = createLogger('ShortcutManager');

/** Elements where typing takes precedence over application shortcuts. */
const EDITABLE = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

export class ShortcutManager {
  /**
   * @param {EventTarget} [target]
   */
  constructor(target = window) {
    /** @private */ this._target = target;
    /** @private @type {Map<string, {handler: (event: KeyboardEvent) => void, allowInFields: boolean}>} */
    this._bindings = new Map();
    /** @private @type {(event: KeyboardEvent) => void} */
    this._listener = (event) => this._dispatch(event);
    /** @private */ this._attached = false;
  }

  /** Begins listening. */
  start() {
    if (this._attached) return;
    this._target.addEventListener('keydown', this._listener);
    this._attached = true;
  }

  /** Stops listening. */
  stop() {
    if (!this._attached) return;
    this._target.removeEventListener('keydown', this._listener);
    this._attached = false;
  }

  /**
   * Registers a shortcut.
   *
   * @param {string} combo Case-insensitive, e.g. `'ctrl+z'`, `'ctrl+shift+z'`, `'/'`.
   * @param {(event: KeyboardEvent) => void} handler
   * @param {object} [options]
   * @param {boolean} [options.allowInFields] Fire even while typing.
   * @returns {() => void} Unregister function.
   */
  register(combo, handler, { allowInFields = false } = {}) {
    const key = ShortcutManager.normalise(combo);
    if (this._bindings.has(key)) log.warn(`Shortcut "${key}" is being reassigned.`);

    this._bindings.set(key, { handler, allowInFields });
    return () => {
      if (this._bindings.get(key)?.handler === handler) this._bindings.delete(key);
    };
  }

  /**
   * Registers several at once and returns a single unregister function.
   * @param {Record<string, (event: KeyboardEvent) => void>} map
   * @param {object} [options]
   * @returns {() => void}
   */
  registerAll(map, options) {
    const removers = Object.entries(map).map(([combo, handler]) => this.register(combo, handler, options));
    return () => removers.forEach((remove) => remove());
  }

  /**
   * Canonical form of a combo so `'Ctrl+Shift+Z'` and `'shift+ctrl+z'` match.
   * @param {string} combo
   * @returns {string}
   */
  static normalise(combo) {
    const parts = combo.toLowerCase().split('+').map((part) => part.trim()).filter(Boolean);
    const modifiers = ['ctrl', 'alt', 'shift', 'meta'].filter((modifier) => parts.includes(modifier));
    const key = parts.find((part) => !['ctrl', 'alt', 'shift', 'meta'].includes(part)) ?? '';
    return [...modifiers, key].join('+');
  }

  /**
   * @private
   * @param {KeyboardEvent} event
   */
  _dispatch(event) {
    const parts = [];
    // metaKey is folded into ctrl so Cmd+Z works on macOS without every call
    // site declaring both variants.
    if (event.ctrlKey || event.metaKey) parts.push('ctrl');
    if (event.altKey) parts.push('alt');
    if (event.shiftKey) parts.push('shift');
    parts.push(event.key.toLowerCase());

    const binding = this._bindings.get(parts.join('+'));
    if (!binding) return;

    const active = document.activeElement;
    const isTyping = active instanceof HTMLElement
      && (EDITABLE.has(active.tagName) || active.isContentEditable);

    if (isTyping && !binding.allowInFields) return;

    event.preventDefault();
    binding.handler(event);
  }

  /**
   * Human-readable list for a help dialog.
   * @returns {string[]}
   */
  listCombos() {
    return [...this._bindings.keys()].sort();
  }
}
