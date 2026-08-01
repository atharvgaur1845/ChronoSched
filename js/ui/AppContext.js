/**
 * @file AppContext.js
 * @description The bundle of services handed to every view.
 *
 * WHY A CONTEXT OBJECT AND NOT IMPORTS
 * If views imported a shared singleton scheduler or repository directly, every
 * view would be permanently welded to one concrete implementation and could
 * never be rendered in a test with fakes. Passing one context object keeps
 * construction in the composition root (main.js) and leaves views depending on
 * an interface they are given rather than a module they reach for.
 *
 * It is a deliberately SHALLOW bag of already-constructed services, not a
 * service locator that resolves things on demand: nothing here can be
 * registered or replaced at runtime, so a view cannot smuggle in a dependency
 * that main.js did not sanction.
 */

/**
 * @typedef {object} Repositories
 * @property {import('../data/repositories/TeacherRepository.js').TeacherRepository} teachers
 * @property {import('../data/repositories/ClassRepository.js').ClassRepository} classes
 * @property {import('../data/repositories/SubjectRepository.js').SubjectRepository} subjects
 * @property {import('../data/repositories/CurriculumRepository.js').CurriculumRepository} curriculum
 * @property {import('../data/repositories/TimetableRepository.js').TimetableRepository} timetables
 * @property {import('../data/repositories/SettingsRepository.js').SettingsRepository} settings
 */

export class AppContext {
  /**
   * @param {object} services
   * @param {import('../core/EventBus.js').EventBus} services.eventBus
   * @param {import('../data/DataService.js').DataService} services.dataService
   * @param {Repositories} services.repositories
   * @param {import('../scheduling/Scheduler.js').Scheduler} services.scheduler
   * @param {import('../services/ValidationService.js').ValidationService} services.validation
   * @param {import('../services/TimetableEditor.js').TimetableEditor} services.editor
   * @param {import('../services/SearchService.js').SearchService} services.search
   * @param {import('../services/transfer/TransferService.js').TransferService} services.transfer
   * @param {import('../managers/ThemeManager.js').ThemeManager} services.theme
   * @param {import('../managers/StorageManager.js').StorageManager} services.storage
   * @param {import('../managers/UndoRedoManager.js').UndoRedoManager} services.history
   * @param {import('../managers/ShortcutManager.js').ShortcutManager} services.shortcuts
   * @param {import('./components/Modal.js').ModalHost} services.modals
   * @param {import('./components/Toaster.js').Toaster} services.toaster
   */
  constructor(services) {
    Object.assign(this, services);

    /** @type {import('./Router.js').Router} Assigned by main.js after construction. */
    this.router = /** @type {*} */ (null);

    /**
     * @type {(message: string, tone?: 'idle'|'busy'|'error') => void}
     * Assigned by AppShell so views can write to the status bar without
     * reaching into the DOM themselves.
     */
    this.setStatus = () => {};
  }

  /**
   * Shortcut for the current aggregate. Views read this constantly, and going
   * through DataService each time makes every call site aware of the layering.
   * @returns {import('../domain/SchoolData.js').SchoolData}
   */
  get schoolData() {
    return this.dataService.schoolData;
  }
}
