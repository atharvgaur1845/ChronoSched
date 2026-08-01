# ChronoSched

An offline school timetable generator. Static site — no backend, no framework, no build step, no account. Everything runs in the browser and stays on the machine it runs on.

Built for one school's principal and administrator.

---

## Run it locally

The app **must be served over HTTP**. Opening `index.html` from disk will not work: browsers block ES modules and `fetch()` of local JSON over the `file://` protocol.

```bash
git clone <your-repo-url> ChronoSched
cd ChronoSched
python3 -m http.server 8000
```

Then open <http://localhost:8000>.

Any static server works — `npx serve`, `php -S localhost:8000`, VS Code's Live Server.

## Deploy to GitHub Pages

Push this repository to GitHub with `main` as the default branch. The workflow in [.github/workflows/deploy.yml](.github/workflows/deploy.yml) verifies the code, then publishes — it passes `enablement: true` to `configure-pages`, so it switches Pages on itself rather than failing on a fresh repository.

The site appears at `https://<user>.github.io/<repo>/`.

**If the first run fails with `Get Pages site failed … Not Found`,** the workflow could not enable Pages for you. Set it manually — **Settings → Pages → Source → GitHub Actions** — and re-run the job. That happens when:

- the repository is **private on a Free plan** (Pages needs Pro or above for private repos), or
- an organisation policy restricts who may enable Pages, or
- `Settings → Actions → General → Workflow permissions` is set to read-only, which strips the `pages: write` permission the workflow requests.

Three details that break static ES-module sites on Pages, all already handled here:

| Detail | Why it matters |
|---|---|
| `.nojekyll` at the repo root | Without it Jekyll strips any path starting with `_`. |
| Relative paths everywhere (`./js/main.js`) | Pages serves from `/<repo-name>/`, so a leading `/` resolves to the domain root and 404s. |
| Third-party libraries committed to `vendor/` | No install step, and the app still works in a school with unreliable internet. |

## First run

The app ships with a demo school (6 classes, 18 subjects, 17 teachers, 54 curriculum rows) so there is something to explore immediately. It is written to browser storage on first load; after that your own data is authoritative and the seeds are never read again. **Settings → Restore demo school** brings it back.

---

## What it does

**Dashboard** — counts, quick actions, and a health check that names every reason the next generation will leave gaps.

**School data** — teachers (qualifications, workload limits, unavailable and preferred-free periods), classes, subjects, and the curriculum that links them.

**Time configuration** — working days, period length, start time, any number of breaks, and which one is the recess.

**Generate** — pick a strategy, tune the preference weights with sliders, generate. Every run creates a **new version**; nothing is ever overwritten. Versions can be renamed, duplicated, compared cell-by-cell and deleted.

**Manual editing** — drag a period to move it, drop it on another to swap. Legal targets are highlighted green before you move the pointer; illegal ones are red and refused with a plain-English reason. Ctrl+Z / Ctrl+Y throughout. Pin a period and the next generation schedules around it.

**Import / export** — Excel in and out (round-trips through the same column definitions, so an exported file re-imports cleanly), PDF one page per class or per teacher, and JSON for a complete backup.

---

## Architecture

Full design rationale: **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

The one rule everything else follows:

```
ui/  ──▶  services/  ──▶  domain/  ──▶  core/
 │                            ▲
 └──▶ managers/ ──────────────┘
```

Dependencies point inward. `domain/` never imports `services/`. `ui/` never touches `localStorage` or `fetch`. `scheduling/` has no DOM references at all — which is why the whole engine runs in Node in 30ms (`npm run test:scheduler`). This is enforced by [tools/verify-modules.mjs](tools/verify-modules.mjs) and checked in CI.

```
index.html            Shell; the only inline script applies the theme pre-paint
css/                  Design tokens → themes → base → components → views
data/                 Read-only seed JSON shipped with the build
vendor/               SheetJS + jsPDF, committed for offline use
js/
  core/               EventBus, Result, Entity, Registry, Command
  domain/             Teacher, SchoolClass, Subject, CurriculumEntry,
                      TimeSlot, TimeGrid, Lesson, Timetable, Settings, SchoolData
  scheduling/         The engine — see below
  data/               IDataSource, LocalStorage/Seed sources, repositories, migrator
  services/           Validation, editing, search, import/export
  managers/           Theme, storage, undo/redo, shortcuts
  commands/           Undoable edits (Command pattern)
  ui/                 Router, View base, components, views
  utils/              Constants, time, DOM, arrays, ids, logger
```

### Design patterns, and what each one actually buys

| Pattern | Where | Payoff |
|---|---|---|
| **Strategy** | `scheduling/strategies/` | Greedy and backtracking behind one interface. A third solver is one new class; `Scheduler.js` never changes. |
| **Constraint registry (OCP)** | `scheduling/constraints/` | A new scheduling rule is one file plus one line in `DefaultConstraints.js`. The solver is never edited again — and because manual drag-and-drop validates through the same registry, the rule applies to hand edits automatically. |
| **Observer** | `core/EventBus.js` | Services announce facts; views react. Neither imports the other. |
| **Command** | `commands/` | Undo/redo stores deltas, not snapshots — so history is cheap and each step has a real label ("Undo: Move Science (10A) to Fri P1"). |
| **Repository** | `data/repositories/` | Collection semantics separated from persistence, and the place integrity rules live. |
| **Adapter behind `IDataSource`** | `data/` | The backend migration seam. See below. |
| **Factory** | `services/transfer/` | Export formats are registered, so the Export menu builds itself. |
| **Template Method** | `ui/views/EntityListView.js` | Four management screens share one implementation of search, edit, confirm-delete. |

### The scheduling engine

```
Settings ──▶ TimeGrid ──▶ SchedulingContext        (immutable, precomputed)
Curriculum ─▶ CurriculumExpander ─▶ demands ─▶ ordered hardest-first
Locked lessons ─▶ seeded into ScheduleState, their demand subtracted
demands ─▶ ISchedulingStrategy ─▶ ScheduleState
ScheduleState ─▶ LocalSearchOptimizer              (optional polish pass)
ScheduleState ─▶ SchedulingReport ─▶ Timetable     (new version)
```

**Hard constraints filter; soft constraints rank.** Clashes, teacher availability, workload caps, per-subject daily caps and lab-block atomicity are absolute. "Main subjects in periods 1–6", recess-side preference, teacher gaps, preferred free periods and difficulty spread carry a weighted price — because as hard rules they make most real schools unsolvable.

Those weights live in Settings and are exposed as sliders, so an administrator retunes the timetable's priorities **without a code change**.

`ScheduleState` keeps six redundant indexes so a feasibility check is O(1) rather than O(lessons). That single decision is the difference between generating in ~30ms and hanging the tab.

Measured on the bundled demo school (6 classes, 220 periods a week):

```
placed        220/220 (100%)
core periods inside window 1–6:  176/176 (100%)
hard-constraint violations       0
time                             32 ms
```

An over-subscribed school (every teacher capped at 6 periods a week) returns 110/220 in 1.1s with a per-row explanation — it degrades and reports rather than hanging or lying.

### Adding a backend later

Every data method is `async` today even though LocalStorage is synchronous. That is deliberate: with synchronous signatures, adding HTTP later means rewriting every call site. Instead the migration is:

1. Write `RestDataSource` against the existing four-method `IDataSource`.
2. Change one line in [js/main.js](js/main.js):

```js
const source = new LocalStorageDataSource(storage);
// becomes
const source = new RestDataSource('https://api.example.com');
```

Nothing in `domain/`, `scheduling/`, `services/` or `ui/` changes. The constraint classes are pure functions over plain data, so a FastAPI port can mirror them one-to-one.

---

## Development

```bash
npm start              # serve on :8000
npm run verify         # imports resolve, exports exist, layering is clean
npm run test:scheduler # run the engine headlessly and audit its output
```

There are no dependencies to install. `npm` is used only as a script runner.

`verify-modules.mjs` exists because a no-build-step project has no compiler to catch a renamed export or a mistyped path — the failure would arrive as a blank page. It also enforces the layering rule, so an accidental `import` from `domain/` into `ui/` fails CI.

## Browser support

Any browser with ES2022 modules, CSS custom properties and `structuredClone` — Chrome/Edge 98+, Firefox 94+, Safari 15.4+.

## Storage and privacy

Everything lives in this browser's LocalStorage under the `chronosched:v1:` prefix. Nothing is transmitted anywhere; there is no server to transmit to.

Browser storage is not a backup. It can be wiped by "clear browsing data" or reclaimed by the browser under disk pressure. **Export a JSON backup regularly** — Settings → Export → JSON backup is the only complete, portable copy.

Every stored payload carries a `schemaVersion`, and [js/data/SchemaMigrator.js](js/data/SchemaMigrator.js) upgrades older ones on load, so a future model change will not discard a term's work.

## Licence

MIT.
