/**
 * @file DashboardView.js
 * @description Landing screen: counts, quick actions, and a health check.
 *
 * THE HEALTH CHECK IS THE POINT OF THIS SCREEN.
 * Counts are pleasant; the list of reasons the next generation will disappoint
 * you is genuinely useful. "No teacher can take Chemistry for 12 Science" shown
 * here costs thirty seconds to fix. The same problem discovered as an
 * unexplained gap after generating is a confusing afternoon.
 */

import { View } from '../View.js';
import { el } from '../../utils/DomUtils.js';
import { Events, Routes } from '../../utils/Constants.js';
import { formatRelative } from '../../utils/TimeUtils.js';

export class DashboardView extends View {
  /** @returns {string} */
  get title() { return 'Dashboard'; }

  /** @override */
  onMount() {
    this.subscribeAll([
      Events.TEACHERS_CHANGED, Events.CLASSES_CHANGED, Events.SUBJECTS_CHANGED,
      Events.CURRICULUM_CHANGED, Events.TIMETABLES_CHANGED, Events.SETTINGS_CHANGED,
      Events.DATA_READY,
    ], () => this.refresh());
  }

  /** @returns {Node} */
  render() {
    const data = this.schoolData;
    const counts = data.counts;
    const active = data.activeTimetable;
    const findings = this.context.validation.auditSchoolData(data);

    return el('div', { class: 'view' }, [
      el('header', { class: 'view-header' }, [
        el('div', { class: 'view-header__text' }, [
          el('h1', { text: data.settings.school.name }),
          el('p', {
            class: 'u-secondary u-small',
            text: `Academic year ${data.settings.school.academicYear} · `
              + `${data.timeGrid.dayCount} days × ${data.timeGrid.periodCount} periods `
              + `(${data.settings.dayStart}–${data.settings.dayEnd})`,
          }),
        ]),
        el('div', { class: 'view-header__actions' }, [
          el('button', {
            class: 'button button--primary',
            text: 'Generate timetable',
            on: { click: () => this.context.router.navigate(Routes.GENERATE) },
          }),
        ]),
      ]),

      this._renderStats(counts, data),
      this._renderQuickActions(active),
      this._renderHealth(findings),
      active ? this._renderActiveSummary(active) : this._renderNoTimetable(),
    ]);
  }

  /**
   * @private
   * @returns {Node}
   */
  _renderStats(counts, data) {
    const capacity = data.timeGrid.slotCount * Math.max(1, counts.classes);
    const utilisation = capacity === 0 ? 0 : Math.round((counts.weeklyPeriods / capacity) * 100);

    /** @param {object} config */
    const card = ({ value, label, hint, route }) => el('a', {
      class: 'stat-card',
      href: route,
      attrs: { 'aria-label': `${value} ${label}` },
    }, [
      el('span', { class: 'stat-card__value', text: String(value) }),
      el('span', { class: 'stat-card__label', text: label }),
      el('span', { class: 'stat-card__hint', text: hint }),
    ]);

    return el('section', { class: 'stat-grid' }, [
      card({ value: counts.teachers, label: 'Teachers', hint: 'Staff on record', route: Routes.TEACHERS }),
      card({ value: counts.classes, label: 'Classes', hint: 'Each gets a timetable', route: Routes.CLASSES }),
      card({ value: counts.subjects, label: 'Subjects', hint: 'In the catalogue', route: Routes.SUBJECTS }),
      card({ value: counts.curriculum, label: 'Curriculum rows', hint: `${counts.weeklyPeriods} periods a week`, route: Routes.CURRICULUM }),
      card({ value: counts.timetables, label: 'Versions', hint: 'Generated timetables', route: Routes.TIMETABLE }),
      card({ value: `${utilisation}%`, label: 'Week filled', hint: 'Across all classes', route: Routes.CURRICULUM }),
    ]);
  }

  /**
   * @private
   * @returns {Node}
   */
  _renderQuickActions(active) {
    /** @param {object} config */
    const action = ({ icon, label, description, onClick, disabled = false }) => el('button', {
      class: 'quick-action',
      disabled,
      on: { click: onClick },
    }, [
      el('span', { class: 'quick-action__icon', text: icon, attrs: { 'aria-hidden': 'true' } }),
      el('span', {}, [
        el('span', { class: 'quick-action__label', text: label }),
        el('span', { class: 'quick-action__desc', text: description }),
      ]),
    ]);

    return el('section', { class: 'card' }, [
      el('div', { class: 'card__header' }, [el('h2', { text: 'Quick actions' })]),
      el('div', { class: 'card__body' }, [
        el('div', { class: 'quick-actions' }, [
          action({
            icon: '▦',
            label: 'Current timetable',
            description: active ? active.label : 'Nothing generated yet',
            disabled: !active,
            onClick: () => this.context.router.navigate(Routes.TIMETABLE),
          }),
          action({
            icon: '⚙',
            label: 'Generate timetable',
            description: 'Create a new version',
            onClick: () => this.context.router.navigate(Routes.GENERATE),
          }),
          action({
            icon: '👤',
            label: 'By teacher',
            description: 'One teacher\'s week',
            disabled: !active,
            onClick: () => this.context.router.navigate(Routes.TIMETABLE, { mode: 'teacher' }),
          }),
          action({
            icon: '⇩',
            label: 'Import Excel',
            description: 'Load staff and curriculum',
            onClick: () => this.context.router.navigate(Routes.SETTINGS, { section: 'import' }),
          }),
          action({
            icon: '⇧',
            label: 'Export',
            description: 'Excel, PDF or JSON backup',
            onClick: () => this.context.router.navigate(Routes.SETTINGS, { section: 'export' }),
          }),
          action({
            icon: '🕘',
            label: 'Time configuration',
            description: `${this.schoolData.timeGrid.periodCount} periods a day`,
            onClick: () => this.context.router.navigate(Routes.TIME_CONFIG),
          }),
        ]),
      ]),
    ]);
  }

  /**
   * @private
   * @param {Array<{level: string, message: string}>} findings
   * @returns {Node}
   */
  _renderHealth(findings) {
    const blocking = findings.filter((item) => item.level === 'danger');
    const advisories = findings.filter((item) => item.level !== 'danger');

    return el('section', { class: 'card' }, [
      el('div', { class: 'card__header' }, [
        el('h2', { text: 'Health check' }),
        el('span', { class: 'u-spacer' }),
        el('span', {
          class: `chip ${blocking.length > 0 ? 'chip--danger' : advisories.length > 0 ? 'chip--warning' : 'chip--success'}`,
          text: blocking.length > 0
            ? `${blocking.length} blocking issue${blocking.length === 1 ? '' : 's'}`
            : advisories.length > 0
              ? `${advisories.length} advisory`
              : 'All clear',
        }),
      ]),
      el('div', { class: 'card__body' }, [
        findings.length === 0
          ? el('div', { class: 'alert alert--success' }, [
            el('span', { class: 'alert__icon', text: '✓' }),
            el('div', { class: 'alert__body', text: 'Everything looks schedulable. Nothing is over capacity and every subject has a teacher.' }),
          ])
          : el('div', { class: 'health-list' }, [
            // Blocking problems first: they are the ones that will actually
            // cost the user a period on the timetable.
            ...blocking.map((item) => this._finding(item)),
            ...advisories.map((item) => this._finding(item)),
          ]),
        el('p', {
          class: 'help-hint',
          text: 'Red items will leave gaps in the generated timetable. Amber items are worth a look but will not stop generation.',
        }),
      ]),
    ]);
  }

  /**
   * @private
   * @param {{level: string, message: string}} finding
   * @returns {Node}
   */
  _finding(finding) {
    const icon = finding.level === 'danger' ? '!' : finding.level === 'warning' ? '?' : 'i';
    return el('div', { class: `alert alert--${finding.level}` }, [
      el('span', { class: 'alert__icon', text: icon, attrs: { 'aria-hidden': 'true' } }),
      el('div', { class: 'alert__body', text: finding.message }),
    ]);
  }

  /**
   * @private
   * @param {import('../../domain/Timetable.js').Timetable} active
   * @returns {Node}
   */
  _renderActiveSummary(active) {
    const report = active.report ?? {};
    const stale = active.settingsHash && active.settingsHash !== this.schoolData.settings.geometryHash;

    return el('section', { class: 'card' }, [
      el('div', { class: 'card__header' }, [
        el('h2', { text: `Active: ${active.label}` }),
        el('span', { class: 'u-spacer' }),
        el('span', { class: 'u-muted u-small', text: formatRelative(active.createdAt) }),
      ]),
      el('div', { class: 'card__body u-stack' }, [
        stale && el('div', { class: 'alert alert--warning' }, [
          el('span', { class: 'alert__icon', text: '!' }),
          el('div', { class: 'alert__body', text: 'The school day has changed since this version was generated, so it may not match the current period times. Generate a new version to be sure.' }),
        ]),
        el('div', { class: 'stat-grid' }, [
          this._metric(`${report.placedPeriods ?? active.lessonCount}`, 'Periods placed'),
          this._metric(`${Math.round((report.fillRate ?? 1) * 100)}%`, 'Curriculum covered'),
          this._metric(`${report.missingPeriods ?? 0}`, 'Periods missing'),
          this._metric(`${active.lockedCount}`, 'Pinned by hand'),
        ]),
        el('div', { class: 'u-row' }, [
          el('button', {
            class: 'button button--primary',
            text: 'Open timetable',
            on: { click: () => this.context.router.navigate(Routes.TIMETABLE) },
          }),
          el('button', {
            class: 'button',
            text: 'Generate another version',
            on: { click: () => this.context.router.navigate(Routes.GENERATE) },
          }),
        ]),
      ]),
    ]);
  }

  /**
   * @private
   * @returns {Node}
   */
  _renderNoTimetable() {
    return el('section', { class: 'card' }, [
      el('div', { class: 'card__body' }, [
        el('div', { class: 'empty-state' }, [
          el('div', { class: 'empty-state__icon', text: '▦' }),
          el('div', { class: 'empty-state__title', text: 'No timetable yet' }),
          el('p', { class: 'u-small u-muted', text: 'Once your classes, subjects, teachers and curriculum are in place, generate the first version.' }),
          el('div', { style: { marginTop: 'var(--space-4)' } }, [
            el('button', {
              class: 'button button--primary',
              text: 'Generate the first timetable',
              on: { click: () => this.context.router.navigate(Routes.GENERATE) },
            }),
          ]),
        ]),
      ]),
    ]);
  }

  /**
   * @private
   * @param {string} value
   * @param {string} label
   * @returns {Node}
   */
  _metric(value, label) {
    return el('div', { class: 'stat-card' }, [
      el('span', { class: 'stat-card__value', text: value }),
      el('span', { class: 'stat-card__label', text: label }),
    ]);
  }
}
