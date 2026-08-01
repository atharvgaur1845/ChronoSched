/**
 * @file main.js
 * @description The composition root — the ONLY file that constructs anything.
 *
 * Every `new` in the application happens here (or inside a factory this file
 * calls). Nothing else imports a concrete implementation of a dependency it
 * uses; everything receives what it needs through its constructor.
 *
 * That single rule is what makes the swap to a backend a one-line change:
 *
 *     const source = new LocalStorageDataSource(storage);
 *     // becomes
 *     const source = new RestDataSource('https://api.example.com');
 *
 * Nothing in `domain/`, `scheduling/`, `services/` or `ui/` is touched, because
 * none of them know which implementation they were handed.
 *
 * BOOT ORDER
 *   1. Infrastructure — storage, event bus, data sources.
 *   2. Data           — load from storage, falling back to the shipped seeds.
 *   3. Domain services— scheduler, validation, editing, search, transfer.
 *   4. UI             — context, shell, router, first paint.
 */

import { EventBus } from './core/EventBus.js';

import { StorageManager } from './managers/StorageManager.js';
import { ThemeManager } from './managers/ThemeManager.js';
import { UndoRedoManager } from './managers/UndoRedoManager.js';
import { ShortcutManager } from './managers/ShortcutManager.js';

import { LocalStorageDataSource } from './data/LocalStorageDataSource.js';
import { SeedJsonDataSource } from './data/SeedJsonDataSource.js';
import { SchemaMigrator } from './data/SchemaMigrator.js';
import { DataService } from './data/DataService.js';

import { TeacherRepository } from './data/repositories/TeacherRepository.js';
import { ClassRepository } from './data/repositories/ClassRepository.js';
import { SubjectRepository } from './data/repositories/SubjectRepository.js';
import { CurriculumRepository } from './data/repositories/CurriculumRepository.js';
import { TimetableRepository } from './data/repositories/TimetableRepository.js';
import { SettingsRepository } from './data/repositories/SettingsRepository.js';

import { Scheduler } from './scheduling/Scheduler.js';
import { createDefaultConstraintRegistry } from './scheduling/constraints/DefaultConstraints.js';
import { GreedyHeuristicStrategy } from './scheduling/strategies/GreedyHeuristicStrategy.js';
import { BacktrackingStrategy } from './scheduling/strategies/BacktrackingStrategy.js';
import { LocalSearchOptimizer } from './scheduling/strategies/LocalSearchOptimizer.js';

import { ValidationService } from './services/ValidationService.js';
import { TimetableEditor } from './services/TimetableEditor.js';
import { SearchService } from './services/SearchService.js';
import { TransferService } from './services/transfer/TransferService.js';

import { AppContext } from './ui/AppContext.js';
import { AppShell } from './ui/AppShell.js';
import { Router } from './ui/Router.js';
import { ModalHost } from './ui/components/Modal.js';
import { Toaster } from './ui/components/Toaster.js';
import { SearchBox } from './ui/components/SearchBox.js';

import { DashboardView } from './ui/views/DashboardView.js';
import { TeacherView } from './ui/views/TeacherView.js';
import { ClassView } from './ui/views/ClassView.js';
import { SubjectView } from './ui/views/SubjectView.js';
import { CurriculumView } from './ui/views/CurriculumView.js';
import { TimeConfigView } from './ui/views/TimeConfigView.js';
import { GenerateView } from './ui/views/GenerateView.js';
import { TimetableView } from './ui/views/TimetableView.js';
import { SettingsView } from './ui/views/SettingsView.js';

import { Routes, Events } from './utils/Constants.js';
import { createLogger, setLogLevel, LogLevel } from './utils/Logger.js';

const log = createLogger('main');

/**
 * Route table. The sidebar is generated from this, so adding a screen means
 * adding one entry — there is no second list to keep in step.
 * @param {AppContext} context
 * @returns {import('./ui/Router.js').RouteDefinition[]}
 */
function buildRoutes() {
  return [
    { path: Routes.DASHBOARD, label: 'Dashboard', icon: '⌂', group: 'overview', view: DashboardView },

    { path: Routes.TEACHERS, label: 'Teachers', icon: '👤', group: 'data', view: TeacherView, badge: (context) => context.schoolData.counts.teachers },
    { path: Routes.CLASSES, label: 'Classes', icon: '▤', group: 'data', view: ClassView, badge: (context) => context.schoolData.counts.classes },
    { path: Routes.SUBJECTS, label: 'Subjects', icon: '✎', group: 'data', view: SubjectView, badge: (context) => context.schoolData.counts.subjects },
    { path: Routes.CURRICULUM, label: 'Curriculum', icon: '≡', group: 'data', view: CurriculumView, badge: (context) => context.schoolData.counts.curriculum },
    { path: Routes.TIME_CONFIG, label: 'Time Configuration', icon: '🕘', group: 'data', view: TimeConfigView },

    { path: Routes.GENERATE, label: 'Generate', icon: '⚙', group: 'timetable', view: GenerateView },
    { path: Routes.TIMETABLE, label: 'Timetable', icon: '▦', group: 'timetable', view: TimetableView, badge: (context) => context.schoolData.counts.timetables },
    { path: Routes.SETTINGS, label: 'Settings', icon: '⚙', group: 'timetable', view: SettingsView },
  ];
}

/**
 * Renders a fatal error into the page.
 *
 * A blank white screen is the worst possible failure mode: the user cannot tell
 * whether the app is loading, broken, or has eaten their data. Saying what
 * happened and how to recover is the minimum.
 *
 * @param {Error} error
 */
function renderFatalError(error) {
  const outlet = document.getElementById('view-outlet');
  if (!outlet) return;

  outlet.innerHTML = '';
  const card = document.createElement('div');
  card.className = 'card';
  card.style.maxWidth = '640px';
  card.style.margin = '2rem auto';
  card.innerHTML = `
    <div class="card__header"><h2>ChronoSched could not start</h2></div>
    <div class="card__body">
      <p class="u-secondary">${error.message}</p>
      <p class="help-hint">
        If you opened this file directly from disk, that is the likely cause —
        browsers block JavaScript modules and local file reads over the
        <code>file://</code> protocol. Serve the folder over HTTP instead,
        for example with <code>python3 -m http.server 8000</code>, then open
        <code>http://localhost:8000</code>.
      </p>
    </div>`;
  outlet.appendChild(card);
}

/**
 * Builds and starts the application.
 * @returns {Promise<void>}
 */
async function bootstrap() {
  setLogLevel(location.hostname === 'localhost' || location.hostname === '127.0.0.1'
    ? LogLevel.DEBUG
    : LogLevel.WARN);

  // ---- 1. Infrastructure -------------------------------------------------
  const eventBus = new EventBus();
  const storage = new StorageManager();

  const dataService = new DataService({
    primary: new LocalStorageDataSource(storage),
    seed: new SeedJsonDataSource(),
    migrator: new SchemaMigrator(),
    eventBus,
  });

  // ---- 2. Data -----------------------------------------------------------
  await dataService.bootstrap();

  const repositories = {
    teachers: new TeacherRepository({ dataService, eventBus }),
    classes: new ClassRepository({ dataService, eventBus }),
    subjects: new SubjectRepository({ dataService, eventBus }),
    curriculum: new CurriculumRepository({ dataService, eventBus }),
    timetables: new TimetableRepository({ dataService, eventBus }),
    settings: new SettingsRepository({ dataService, eventBus }),
  };

  // ---- 3. Domain services ------------------------------------------------
  const scheduler = new Scheduler({
    registry: createDefaultConstraintRegistry(),
    strategies: [new GreedyHeuristicStrategy(), new BacktrackingStrategy()],
    optimizer: new LocalSearchOptimizer(),
  });

  const validation = new ValidationService({ scheduler });
  const history = new UndoRedoManager({ eventBus });

  const editor = new TimetableEditor({
    dataService,
    timetableRepository: repositories.timetables,
    validationService: validation,
    undoRedoManager: history,
    eventBus,
  });

  const search = new SearchService({ dataService });
  const transfer = new TransferService({ dataService, eventBus, repositories });

  // ---- 4. UI -------------------------------------------------------------
  const shortcuts = new ShortcutManager();
  const theme = new ThemeManager({ dataService, eventBus });
  const modals = new ModalHost(/** @type {HTMLElement} */ (document.getElementById('modal-root')));
  const toaster = new Toaster({
    root: /** @type {HTMLElement} */ (document.getElementById('toast-root')),
    eventBus,
  });

  const context = new AppContext({
    eventBus, dataService, repositories, scheduler, validation,
    editor, search, transfer, theme, storage, history, shortcuts, modals, toaster,
  });

  const router = new Router({
    outlet: /** @type {HTMLElement} */ (document.getElementById('view-outlet')),
    context,
    eventBus,
  });
  context.router = router;
  router.registerAll(buildRoutes());

  const shell = new AppShell({ context, router });
  shell.initialise();

  // eslint-disable-next-line no-new -- constructed for its side effects on the app bar.
  new SearchBox({
    mount: /** @type {HTMLElement} */ (document.getElementById('global-search-mount')),
    searchService: search,
    router,
    shortcuts,
  });

  theme.initialise(await dataService.loadPreferences());
  shortcuts.start();
  router.start();

  if (dataService.wasSeeded) {
    toaster.show(
      'Loaded a sample school so you can explore. Replace it with your own data, or restore it any time from Settings.',
      'info',
      { durationMs: 9000 },
    );
  }
  if (!storage.isPersistent) {
    toaster.error('This browser is blocking local storage, so nothing will be saved. Export a JSON backup before you close the tab.');
  }

  shell.setStatus('Ready');
  log.info(`ChronoSched ready — data source: ${dataService.sourceName}.`);
}

// Surfacing the failure beats a blank page; the console keeps the stack.
bootstrap().catch((error) => {
  console.error('[main] Startup failed.', error);
  renderFatalError(error instanceof Error ? error : new Error(String(error)));
});

// A rejected promise anywhere in the app would otherwise vanish silently.
window.addEventListener('unhandledrejection', (event) => {
  console.error('[main] Unhandled promise rejection.', event.reason);
});
