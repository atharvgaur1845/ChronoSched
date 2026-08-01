/**
 * @file FormField.js
 * @description Labelled form controls, each with an inline explanation.
 *
 * THE HELP HINT IS A REQUIREMENT, NOT DECORATION.
 * The brief asks for "a user guide along the way in easy English explaining how
 * their option choosing will affect the results, by an example, in small
 * less-contrastive text below". Building that into the field factory rather
 * than leaving it to each form is what stops it being skipped on the screens
 * that need it most.
 *
 * Every hint follows the same shape: what the setting does, then a concrete
 * example with real names and numbers. "Sets the maximum" explains nothing;
 * "set 4 and Mrs Sharma will never appear in more than 4 periods on any day"
 * explains everything.
 */

import { el, selectEl } from '../../utils/DomUtils.js';

/**
 * Low-contrast explanatory text.
 * @param {string} text
 * @returns {HTMLElement|null}
 */
export function helpHint(text) {
  return text ? el('p', { class: 'help-hint', text }) : null;
}

/**
 * Wraps a control with its label, hint and error slot.
 * @param {object} config
 * @param {string} config.label
 * @param {HTMLElement} config.control
 * @param {string} [config.help]
 * @param {boolean} [config.required]
 * @param {string} [config.className]
 * @returns {HTMLElement}
 */
export function field({ label, control, help, required = false, className = '' }) {
  const id = control.id || `field-${Math.random().toString(36).slice(2, 9)}`;
  control.id = id;

  return el('div', { class: `field ${className}`.trim() }, [
    el('label', { class: 'field__label', attrs: { for: id } }, [
      label,
      required && el('span', { class: 'req', text: '*', attrs: { 'aria-hidden': 'true' } }),
    ]),
    control,
    helpHint(help),
  ]);
}

/**
 * A text input field.
 * @param {object} config
 * @returns {{wrapper: HTMLElement, input: HTMLInputElement}}
 */
export function textField({ label, value = '', help, required, placeholder = '', type = 'text', attrs = {}, className = '' }) {
  const input = /** @type {HTMLInputElement} */ (el('input', {
    class: 'input', type, value, attrs: { placeholder, ...attrs },
  }));
  return { wrapper: field({ label, control: input, help, required, className }), input };
}

/**
 * A number input field.
 * @param {object} config
 * @returns {{wrapper: HTMLElement, input: HTMLInputElement}}
 */
export function numberField({ label, value = 0, help, required, min, max, step = 1, className = '' }) {
  const input = /** @type {HTMLInputElement} */ (el('input', {
    class: 'input',
    type: 'number',
    value: String(value),
    attrs: { min, max, step, inputmode: 'numeric' },
  }));
  return { wrapper: field({ label, control: input, help, required, className }), input };
}

/**
 * A dropdown field.
 * @param {object} config
 * @returns {{wrapper: HTMLElement, select: HTMLSelectElement}}
 */
export function selectField({ label, options, value = '', help, required, placeholder, className = '' }) {
  const select = selectEl(options, { value, placeholder });
  return { wrapper: field({ label, control: select, help, required, className }), select };
}

/**
 * A checkbox with its label to the right, hint underneath.
 * @param {object} config
 * @returns {{wrapper: HTMLElement, input: HTMLInputElement}}
 */
export function checkboxField({ label, checked = false, help, className = '' }) {
  const input = /** @type {HTMLInputElement} */ (el('input', { type: 'checkbox', checked }));
  const id = `check-${Math.random().toString(36).slice(2, 9)}`;
  input.id = id;

  const wrapper = el('div', { class: `field ${className}`.trim() }, [
    el('div', { class: 'checkbox-row' }, [
      input,
      el('label', { class: 'field__label', attrs: { for: id }, text: label }),
    ]),
    helpHint(help),
  ]);
  return { wrapper, input };
}

/**
 * A multi-select rendered as toggle chips.
 *
 * A native `<select multiple>` is unusable on touch devices and requires
 * ctrl-clicking on desktop — neither is acceptable for picking twelve subjects.
 *
 * @param {object} config
 * @param {string} config.label
 * @param {Array<{value: string, label: string}>} config.options
 * @param {string[]} config.selected
 * @param {string} [config.help]
 * @param {string} [config.emptyText] Shown when there are no options at all.
 * @returns {{wrapper: HTMLElement, getSelected: () => string[]}}
 */
export function chipMultiSelect({ label, options, selected, help, emptyText = 'Nothing to choose from yet.' }) {
  const chosen = new Set(selected);

  const list = el('div', { class: 'chip-list' }, options.length === 0
    ? [el('span', { class: 'u-muted u-small', text: emptyText })]
    : options.map((option) => {
      const button = el('button', {
        class: 'day-toggle',
        type: 'button',
        text: option.label,
        attrs: { 'aria-pressed': chosen.has(option.value) ? 'true' : 'false' },
        on: {
          click: () => {
            if (chosen.has(option.value)) chosen.delete(option.value);
            else chosen.add(option.value);
            button.setAttribute('aria-pressed', chosen.has(option.value) ? 'true' : 'false');
          },
        },
      });
      return button;
    }));

  const wrapper = el('div', { class: 'field' }, [
    el('span', { class: 'field__label', text: label }),
    list,
    helpHint(help),
  ]);

  return { wrapper, getSelected: () => [...chosen] };
}

/**
 * A read-only summary row, used in detail panels.
 * @param {string} label
 * @param {string|Node} value
 * @returns {HTMLElement}
 */
export function summaryRow(label, value) {
  return el('div', { class: 'report-metric' }, [
    el('span', { class: 'u-secondary', text: label }),
    typeof value === 'string' || typeof value === 'number'
      ? el('span', { class: 'report-metric__value', text: String(value) })
      : el('span', { class: 'report-metric__value' }, [value]),
  ]);
}
