/**
 * @file DomUtils.js
 * @description The app's entire "rendering library" — about 120 lines.
 *
 * Building elements through {@link el} instead of innerHTML strings gives three
 * things a template string cannot: XSS safety by construction (text is always
 * set via textContent), real event-listener references that can be removed on
 * unmount, and no re-parsing cost on every render.
 */

/** Property keys of {@link el}'s options that are handled specially. */
const SPECIAL_KEYS = new Set(['class', 'text', 'html', 'dataset', 'attrs', 'style', 'on', 'children']);

/**
 * Creates an element.
 *
 * @param {string} tag Tag name, e.g. `'div'`.
 * @param {object} [options]
 * @param {string} [options.class] Class list.
 * @param {string|number} [options.text] Text content (safely escaped by the DOM).
 * @param {string} [options.html] Trusted HTML. Only ever pass app-authored markup.
 * @param {Record<string,string|number|boolean>} [options.dataset] `data-*` attributes.
 * @param {Record<string,string|number|boolean|null>} [options.attrs] Arbitrary attributes.
 * @param {Record<string,string>} [options.style] Inline style properties.
 * @param {Record<string,EventListener>} [options.on] Event listeners keyed by type.
 * @param {Array<Node|string|null|undefined|false>} [options.children] Child nodes.
 * @param {...*} rest Any remaining option key is assigned as a DOM property.
 * @returns {HTMLElement}
 */
export function el(tag, options = {}, ...rest) {
  const node = document.createElement(tag);

  if (options.class) node.className = options.class;
  if (options.text !== undefined && options.text !== null) node.textContent = String(options.text);
  if (options.html !== undefined) node.innerHTML = options.html;

  if (options.dataset) {
    for (const [key, value] of Object.entries(options.dataset)) {
      if (value === null || value === undefined) continue;
      node.dataset[key] = String(value);
    }
  }

  if (options.attrs) {
    for (const [key, value] of Object.entries(options.attrs)) {
      if (value === null || value === undefined || value === false) continue;
      node.setAttribute(key, value === true ? '' : String(value));
    }
  }

  if (options.style) {
    for (const [key, value] of Object.entries(options.style)) {
      if (key.startsWith('--')) node.style.setProperty(key, String(value));
      else node.style[key] = String(value);
    }
  }

  if (options.on) {
    for (const [type, handler] of Object.entries(options.on)) node.addEventListener(type, handler);
  }

  // Any option key we did not claim becomes a direct property assignment,
  // which is how `value`, `checked`, `disabled` and friends are set.
  for (const [key, value] of Object.entries(options)) {
    if (!SPECIAL_KEYS.has(key)) node[key] = value;
  }

  const children = options.children ?? rest.flat();
  appendChildren(node, children);

  return node;
}

/**
 * Appends a mixed list of nodes and strings, skipping falsy entries so callers
 * can write `condition && el(...)` inline.
 * @param {Node} parent
 * @param {Array<Node|string|null|undefined|false>} children
 * @returns {Node} The parent, for chaining.
 */
export function appendChildren(parent, children) {
  for (const child of [children].flat(Infinity)) {
    if (child === null || child === undefined || child === false || child === '') continue;
    parent.appendChild(typeof child === 'string' || typeof child === 'number'
      ? document.createTextNode(String(child))
      : child);
  }
  return parent;
}

/**
 * Creates a DocumentFragment from a list of children so a render can append
 * once instead of N times — a measurable win on the timetable grid.
 * @param {Array<Node|string|null|undefined|false>} children
 * @returns {DocumentFragment}
 */
export function fragment(children) {
  return appendChildren(document.createDocumentFragment(), children);
}

/**
 * Removes all children from a node.
 * @param {Node} node
 * @returns {Node}
 */
export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

/**
 * Replaces a node's contents in a single reflow.
 * @param {Node} parent
 * @param {Array<Node|string|null|undefined|false>|Node} children
 */
export function replaceChildren(parent, children) {
  clear(parent);
  appendChildren(parent, Array.isArray(children) ? children : [children]);
}

/**
 * Attaches one delegated listener to a container instead of N listeners to N
 * rows. Essential for tables and the timetable grid.
 *
 * @param {HTMLElement} container
 * @param {string} eventType
 * @param {string} selector CSS selector the event target must match or be inside.
 * @param {(event: Event, matched: HTMLElement) => void} handler
 * @returns {() => void} Unsubscribe function.
 */
export function delegate(container, eventType, selector, handler) {
  /** @param {Event} event */
  const listener = (event) => {
    const target = event.target instanceof Element ? event.target.closest(selector) : null;
    if (target && container.contains(target)) handler(event, /** @type {HTMLElement} */ (target));
  };
  container.addEventListener(eventType, listener);
  return () => container.removeEventListener(eventType, listener);
}

/**
 * Convenience wrapper returning an unsubscribe function, so views can collect
 * teardown callbacks in one array.
 * @param {EventTarget} target
 * @param {string} type
 * @param {EventListener} handler
 * @param {AddEventListenerOptions} [options]
 * @returns {() => void}
 */
export function on(target, type, handler, options) {
  target.addEventListener(type, handler, options);
  return () => target.removeEventListener(type, handler, options);
}

/**
 * Builds an `<option>`-populated select.
 * @param {Array<{value: string, label: string}>} items
 * @param {object} [options]
 * @param {string} [options.value] Currently selected value.
 * @param {string} [options.placeholder] Adds a leading empty option.
 * @param {string} [options.class]
 * @param {Record<string,EventListener>} [options.on]
 * @param {Record<string,string>} [options.attrs]
 * @returns {HTMLSelectElement}
 */
export function selectEl(items, options = {}) {
  const select = el('select', {
    class: options.class ?? 'select',
    on: options.on,
    attrs: options.attrs,
  });

  if (options.placeholder !== undefined) {
    select.appendChild(el('option', { value: '', text: options.placeholder }));
  }
  for (const item of items) {
    select.appendChild(el('option', { value: item.value, text: item.label }));
  }
  select.value = options.value ?? '';
  return select;
}

/**
 * Triggers a client-side file download from an in-memory blob.
 * @param {Blob} blob
 * @param {string} filename
 */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = el('a', { href: url, download: filename });
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoke on the next tick — revoking synchronously cancels the download in Safari.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * Opens a file picker and resolves with the chosen files.
 * @param {object} [options]
 * @param {string} [options.accept] Accept attribute, e.g. `'.xlsx,.json'`.
 * @param {boolean} [options.multiple]
 * @returns {Promise<File[]>}
 */
export function pickFiles({ accept = '', multiple = false } = {}) {
  return new Promise((resolve) => {
    const input = el('input', { type: 'file', accept, multiple, class: 'u-hidden' });
    input.addEventListener('change', () => {
      resolve([...(input.files ?? [])]);
      input.remove();
    }, { once: true });
    document.body.appendChild(input);
    input.click();
  });
}
