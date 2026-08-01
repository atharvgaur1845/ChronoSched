/**
 * @file GenerateView.js
 * @description Choose a strategy, tune the preferences, generate a new version.
 *
 * Generation is synchronous and takes tens of milliseconds, so there is no
 * progress bar — but the button still yields to the browser for one frame
 * before solving. Without that the "Generating…" label never paints, and on a
 * slow device the app looks frozen for the duration.
 */

import { View } from '../View.js';
import { el, replaceChildren } from '../../utils/DomUtils.js';
import { checkboxField, helpHint } from '../components/FormField.js';
import { WEIGHT_DESCRIPTORS } from '../../scheduling/constraints/DefaultConstraints.js';
import { Events, Routes, StrategyId } from '../../utils/Constants.js';

export class GenerateView extends View {
  /** @returns {string} */
  get title() { return 'Generate'; }

  /** @override */
  constructor(context, params) {
    super(context, params);
    /** @private */ this._strategyId = StrategyId.BACKTRACKING;
    /** @private */ this._optimize = true;
    /** @private */ this._keepPinned = true;
    /** @private */ this._busy = false;
    /** @private @type {object|null} */ this._lastReport = null;
    /** @private @type {Record<string, number>} */
    this._weights = { ...this.schoolData.settings.constraintWeights };
  }

  /** @override */
  onMount() {
    this.subscribeAll([Events.CURRICULUM_CHANGED, Events.SETTINGS_CHANGED, Events.DATA_READY],
      () => this.refresh());
  }

  /** @returns {Node} */
  render() {
    const findings = this.context.validation.auditSchoolData(this.schoolData);
    const blocking = findings.filter((item) => item.level === 'danger');

    /** @private */ this._resultSlot = el('div');

    return el('div', { class: 'view' }, [
      el('header', { class: 'view-header' }, [
        el('div', { class: 'view-header__text' }, [
          el('h1', { text: 'Generate a timetable' }),
          el('p', {
            class: 'u-secondary u-small',
            text: 'Each run creates a NEW version. Nothing you already have is overwritten.',
          }),
        ]),
      ]),

      blocking.length > 0 && el('div', { class: 'alert alert--warning' }, [
        el('span', { class: 'alert__icon', text: '!' }),
        el('div', { class: 'alert__body' }, [
          el('div', { text: `${blocking.length} problem(s) will leave gaps in the result:` }),
          el('ul', { style: { margin: 'var(--space-2) 0 0 var(--space-4)' } },
            blocking.slice(0, 5).map((item) => el('li', { text: item.message }))),
          el('div', { style: { marginTop: 'var(--space-3)' } }, [
            el('button', {
              class: 'button button--small',
              text: 'Review on the dashboard',
              on: { click: () => this.context.router.navigate(Routes.DASHBOARD) },
            }),
          ]),
        ]),
      ]),

      el('div', { class: 'generate-layout' }, [
        el('div', { class: 'u-stack' }, [
          this._renderStrategyCard(),
          this._renderWeightsCard(),
        ]),
        el('div', { class: 'u-stack' }, [
          this._renderRunCard(),
          this._resultSlot,
        ]),
      ]),
    ]);
  }

  /**
   * @private
   * @returns {Node}
   */
  _renderStrategyCard() {
    const options = this.context.scheduler.availableStrategies.map((strategy) => {
      const input = el('input', {
        type: 'radio',
        name: 'strategy',
        value: strategy.id,
        checked: strategy.id === this._strategyId,
      });
      input.addEventListener('change', () => { this._strategyId = strategy.id; });

      return el('label', { class: 'strategy-option' }, [
        input,
        el('span', {}, [
          el('div', { class: 'strategy-option__title', text: strategy.displayName }),
          el('div', { class: 'strategy-option__desc', text: strategy.description }),
        ]),
      ]);
    });

    const optimize = checkboxField({
      label: 'Polish the result afterwards',
      checked: this._optimize,
      help: 'Runs a second pass that moves individual periods to better slots. Example: a Maths period sitting in period 8 is pulled forward into the morning if a suitable gap exists. Adds a few milliseconds and never makes the timetable worse.',
    });
    optimize.input.addEventListener('change', () => {
      this._optimize = /** @type {HTMLInputElement} */ (optimize.input).checked;
    });

    const active = this.context.repositories.timetables.getActive();
    const pinnedCount = active?.lockedCount ?? 0;

    const keepPinned = checkboxField({
      label: `Keep pinned periods from ${active ? active.label : 'the current version'} (${pinnedCount})`,
      checked: this._keepPinned,
      help: 'Pinned periods stay exactly where they are and everything else is scheduled around them. Example: pin the Monday morning assembly slot, regenerate, and it will not move. Pin periods with the lock button on the timetable screen.',
    });
    keepPinned.input.addEventListener('change', () => {
      this._keepPinned = /** @type {HTMLInputElement} */ (keepPinned.input).checked;
    });

    return el('section', { class: 'card' }, [
      el('div', { class: 'card__header' }, [el('h2', { text: 'How to build it' })]),
      el('div', { class: 'card__body u-stack' }, [
        ...options,
        optimize.wrapper,
        pinnedCount > 0 ? keepPinned.wrapper : helpHint('No periods are pinned. Pin one from the timetable screen if you want it protected from the next generation.'),
      ]),
    ]);
  }

  /**
   * Weight sliders. These are the Open/Closed Principle made visible: each row
   * is generated from a registered soft constraint, so adding a rule adds a
   * slider here with no change to this file.
   * @private
   * @returns {Node}
   */
  _renderWeightsCard() {
    const rows = WEIGHT_DESCRIPTORS.map((descriptor) => {
      const value = this._weights[descriptor.key] ?? 5;
      const readout = el('span', { class: 'weight-row__value', text: String(value) });

      const slider = el('input', {
        type: 'range',
        min: '0',
        max: '20',
        step: '1',
        value: String(value),
        attrs: { 'aria-label': descriptor.label },
      });
      slider.addEventListener('input', () => {
        const next = Number(/** @type {HTMLInputElement} */ (slider).value);
        this._weights[descriptor.key] = next;
        readout.textContent = String(next);
      });

      return el('div', { class: 'field' }, [
        el('div', { class: 'weight-row' }, [
          el('span', { class: 'field__label', text: descriptor.label }),
          slider,
          readout,
        ]),
        helpHint(descriptor.help),
      ]);
    });

    return el('section', { class: 'card' }, [
      el('div', { class: 'card__header' }, [
        el('h2', { text: 'Preferences' }),
        el('span', { class: 'u-spacer' }),
        el('button', {
          class: 'button button--small',
          text: 'Save as default',
          on: { click: () => this._saveWeights() },
        }),
      ]),
      el('div', { class: 'card__body u-stack' }, [
        helpHint('0 means "ignore this completely". 20 means "try very hard". These are preferences, not rules — clashes, teacher availability and workload limits are always enforced no matter what these are set to.'),
        ...rows,
      ]),
    ]);
  }

  /**
   * @private
   * @returns {Node}
   */
  _renderRunCard() {
    const counts = this.schoolData.counts;
    const ready = counts.curriculum > 0;

    /** @private */ this._runButton = el('button', {
      class: 'button button--primary button--block',
      text: 'Generate new version',
      disabled: !ready || this._busy,
      on: { click: () => this._run() },
    });

    return el('section', { class: 'card' }, [
      el('div', { class: 'card__header' }, [el('h2', { text: 'Run' })]),
      el('div', { class: 'card__body u-stack' }, [
        el('div', { class: 'report-metric' }, [
          el('span', { class: 'u-secondary', text: 'Periods to place' }),
          el('span', { class: 'report-metric__value', text: String(counts.weeklyPeriods) }),
        ]),
        el('div', { class: 'report-metric' }, [
          el('span', { class: 'u-secondary', text: 'Next version number' }),
          el('span', { class: 'report-metric__value', text: String(this.context.repositories.timetables.nextVersionNumber) }),
        ]),
        this._runButton,
        !ready && helpHint('Add some curriculum rows first — there is nothing to schedule yet.'),
      ]),
    ]);
  }

  /** @private */
  async _run() {
    if (this._busy) return;
    this._busy = true;

    const button = /** @type {HTMLButtonElement} */ (this._runButton);
    button.disabled = true;
    button.textContent = 'Generating…';
    this.context.setStatus('Generating timetable…', 'busy');

    // Yield one frame so the disabled state and label actually paint before the
    // main thread is occupied by the solver.
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));

    try {
      // Sliders are applied for this run without being saved, so the user can
      // experiment freely; "Save as default" is the explicit commit.
      const settings = this.schoolData.settings.withChanges({ constraintWeights: this._weights });
      const previousSettings = this.schoolData.settings;
      this.schoolData.settings = settings;

      const basedOn = this._keepPinned ? this.context.repositories.timetables.getActive() : null;

      const timetable = this.context.scheduler.generate(this.schoolData, {
        strategyId: this._strategyId,
        optimize: this._optimize,
        basedOn,
      });

      this.schoolData.settings = previousSettings;

      const stored = await this.context.repositories.timetables.addVersion(timetable);
      if (!stored.ok) {
        this.toast(stored.errors.join(' '), 'danger');
        return;
      }
      for (const warning of stored.warnings) this.toast(warning, 'warning');

      this._lastReport = stored.value.report;
      this._renderResult(stored.value);
      this.context.setStatus(`Created ${stored.value.label}`);
      this.toast(`${stored.value.label} created — ${this._lastReport.placedPeriods} of ${this._lastReport.requiredPeriods} periods placed.`, 'success');
    } catch (error) {
      this.context.setStatus('Generation failed', 'error');
      this.toast(`Generation failed: ${error.message}`, 'danger');
      throw error;
    } finally {
      this._busy = false;
      button.disabled = false;
      button.textContent = 'Generate new version';
    }
  }

  /**
   * @private
   * @param {import('../../domain/Timetable.js').Timetable} timetable
   */
  _renderResult(timetable) {
    const report = timetable.report;
    const complete = report.missingPeriods === 0;

    replaceChildren(this._resultSlot, [
      el('section', { class: 'card' }, [
        el('div', { class: 'card__header' }, [
          el('h2', { text: timetable.label }),
          el('span', { class: 'u-spacer' }),
          el('span', {
            class: `chip ${complete ? 'chip--success' : 'chip--warning'}`,
            text: complete ? 'Complete' : `${report.missingPeriods} missing`,
          }),
        ]),
        el('div', { class: 'card__body u-stack' }, [
          el('div', { class: 'report-metric' }, [
            el('span', { class: 'u-secondary', text: 'Periods placed' }),
            el('span', { class: 'report-metric__value', text: `${report.placedPeriods} / ${report.requiredPeriods} (${Math.round(report.fillRate * 100)}%)` }),
          ]),
          el('div', { class: 'report-metric' }, [
            el('span', { class: 'u-secondary', text: 'Preference cost' }),
            el('span', { class: 'report-metric__value', text: String(report.softScore) }),
          ]),
          el('div', { class: 'report-metric' }, [
            el('span', { class: 'u-secondary', text: 'Time taken' }),
            el('span', { class: 'report-metric__value', text: `${report.durationMs} ms` }),
          ]),

          ...report.warnings.map((warning) => el('div', { class: 'alert alert--warning' }, [
            el('span', { class: 'alert__icon', text: '?' }),
            el('div', { class: 'alert__body', text: warning }),
          ])),

          report.shortfalls.length > 0 && el('div', { class: 'u-stack' }, [
            el('h3', { text: 'What could not be placed' }),
            ...report.shortfalls.slice(0, 8).map((item) => el('div', { class: 'alert alert--danger' }, [
              el('span', { class: 'alert__icon', text: '!' }),
              el('div', { class: 'alert__body' }, [
                el('strong', { text: `${item.className} — ${item.subjectName}: ${item.placed} of ${item.required}` }),
                el('div', { class: 'u-small', text: item.reason }),
              ]),
            ])),
            report.shortfalls.length > 8 && helpHint(`…and ${report.shortfalls.length - 8} more.`),
          ]),

          this._renderBreakdown(report.softBreakdown),

          el('div', { class: 'u-row' }, [
            el('button', {
              class: 'button button--primary',
              text: 'Open this timetable',
              on: { click: () => this.context.router.navigate(Routes.TIMETABLE) },
            }),
            el('button', {
              class: 'button',
              text: 'Generate another',
              on: { click: () => this._run() },
            }),
          ]),
        ]),
      ]),
    ]);
  }

  /**
   * Which preferences the timetable is paying for. Turns an opaque score into
   * something the administrator can act on by moving a slider.
   * @private
   * @param {Record<string, number>} breakdown
   * @returns {Node|null}
   */
  _renderBreakdown(breakdown) {
    const entries = Object.entries(breakdown ?? {}).filter(([, value]) => value > 0);
    if (entries.length === 0) return null;

    entries.sort((left, right) => right[1] - left[1]);
    const total = entries.reduce((sum, [, value]) => sum + value, 0);
    const labelFor = (id) => WEIGHT_DESCRIPTORS.find((item) => id.startsWith(item.key.replace(/[A-Z]/g, (character) => `-${character.toLowerCase()}`)))?.label ?? id;

    return el('div', { class: 'u-stack' }, [
      el('h3', { text: 'Where the cost comes from' }),
      ...entries.map(([id, value]) => el('div', {}, [
        el('div', { class: 'report-metric' }, [
          el('span', { class: 'u-secondary u-small', text: labelFor(id) }),
          el('span', { class: 'report-metric__value', text: String(Math.round(value)) }),
        ]),
        el('div', { class: 'progress' }, [
          el('div', { class: 'progress__bar', style: { width: `${Math.round((value / total) * 100)}%` } }),
        ]),
      ])),
      helpHint('The largest bar is the preference the timetable compromised most. Raise its slider and generate again to trade it against the others.'),
    ]);
  }

  /** @private */
  async _saveWeights() {
    const result = await this.context.repositories.settings.saveWeights(this._weights);
    this.reportResult(result, 'These preferences are now the default.');
  }
}
