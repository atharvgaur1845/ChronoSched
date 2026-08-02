/**
 * @file ValidationService.js
 * @description Checks manual timetable edits against the scheduler's own rules.
 *
 * THE POINT OF THIS FILE IS THAT IT CONTAINS NO RULES.
 * It builds a ScheduleState from the timetable being edited and asks the same
 * {@link ConstraintRegistry} the generator used. There is therefore exactly one
 * definition of "legal" in the codebase. The alternative — a second set of
 * checks written for the UI — starts out identical and drifts apart over a year
 * of maintenance, at which point drag-and-drop can create arrangements the
 * generator considers impossible.
 *
 * A SESSION, NOT A FUNCTION
 * Building the state costs O(lessons). A drag emits `dragover` many times per
 * second, so rebuilding per event would be wasteful. The view opens a session
 * once when the drag starts and asks it many cheap questions.
 */

import { Result } from '../core/Result.js';
import { LessonDemand } from '../scheduling/LessonDemand.js';
import { ScheduleState } from '../scheduling/ScheduleState.js';
import { Priority, RecessSide, Spread } from '../utils/Constants.js';

/**
 * A validation context bound to one timetable snapshot.
 */
export class ValidationSession {
  /**
   * @param {object} deps
   * @param {import('../scheduling/SchedulingContext.js').SchedulingContext} deps.context
   * @param {import('../scheduling/constraints/ConstraintRegistry.js').ConstraintRegistry} deps.registry
   * @param {import('../domain/Timetable.js').Timetable} deps.timetable
   */
  constructor({ context, registry, timetable }) {
    /** @private */ this._context = context;
    /** @private */ this._registry = registry;
    /** @private */ this._timetable = timetable;

    /** @private @type {ScheduleState} */
    this._state = new ScheduleState(context.timeGrid);
    for (const lesson of timetable.lessons) {
      this._state.seedLesson(lesson, context.subject(lesson.subjectId)?.difficulty ?? 3);
    }
  }

  /** @returns {ScheduleState} */
  get state() {
    return this._state;
  }

  /**
   * Reconstructs the demand a lesson represents, so it can be re-checked with
   * the priority, difficulty and daily cap its curriculum row declares.
   *
   * A lesson with no matching curriculum row (the row was deleted after the
   * timetable was generated) still gets a usable demand with safe defaults,
   * because refusing to validate it would leave the cell permanently stuck.
   *
   * @param {import('../domain/Lesson.js').Lesson} lesson
   * @param {number} [size]
   * @returns {LessonDemand}
   */
  demandFor(lesson, size = 1) {
    const entry = this._context.schoolData.curriculum.find(
      (row) => row.classId === lesson.classId && row.subjectId === lesson.subjectId,
    );
    const subject = this._context.subject(lesson.subjectId);

    return new LessonDemand({
      id: `edit:${lesson.classId}:${lesson.subjectId}`,
      curriculumId: entry?.id ?? '',
      classId: lesson.classId,
      subjectId: lesson.subjectId,
      fixedTeacherId: entry?.teacherId ?? null,
      size,
      priority: entry?.priority ?? Priority.ELECTIVE,
      priorityRank: entry?.priorityRank ?? 1,
      recessPreference: entry?.recessPreference ?? RecessSide.ANY,
      spread: entry?.spread ?? Spread.FLEXIBLE,
      periodsPerWeek: entry?.periodsPerWeek ?? 1,
      difficulty: subject?.difficulty ?? 3,
      // Manual edits are the administrator overriding the plan, so the daily
      // cap is relaxed to the curriculum value or a permissive default rather
      // than blocking a deliberate double period.
      maxPerDay: entry?.maxPerDay ?? 8,
      isLab: subject?.isLab ?? false,
      blockId: lesson.blockId,
    });
  }

  /**
   * Can this lesson move to this slot?
   *
   * The lesson is lifted out of the working state before checking, otherwise it
   * clashes with itself whenever the target overlaps its current position.
   *
   * @param {import('../domain/Lesson.js').Lesson} lesson
   * @param {string} targetSlotId
   * @returns {Result} On success `value` is the candidate placement.
   */
  validateMove(lesson, targetSlotId) {
    const targetSlot = this._context.timeGrid.getSlot(targetSlotId);
    if (!targetSlot) return Result.fail('That time slot does not exist.');
    if (lesson.slotId === targetSlotId) return Result.fail('The lesson is already in that period.');
    if (lesson.locked) return Result.fail('This period is pinned. Unpin it before moving it.');

    const demand = this.demandFor(lesson);
    const original = { demand, slots: [this._context.timeGrid.getSlot(lesson.slotId)], teacherId: lesson.teacherId };
    const candidate = { demand, slots: [targetSlot], teacherId: lesson.teacherId };

    return this._checkWithout(original, candidate);
  }

  /**
   * Can a whole consecutive block move so that it starts at `targetSlotId`?
   *
   * Blocks move as one unit. Validating member periods individually would let
   * a double lab be torn in half — the first period lands legally, the second
   * finds its slot taken, and the "consecutive" guarantee the curriculum row
   * asked for is silently lost.
   *
   * @param {import('../domain/Lesson.js').Lesson[]} blockLessons Any order.
   * @param {string} targetSlotId Slot the FIRST period should occupy.
   * @returns {Result} On success `value` is `{slots}` — the target window.
   */
  validateBlockMove(blockLessons, targetSlotId) {
    const grid = this._context.timeGrid;
    if (blockLessons.some((lesson) => lesson.locked)) {
      return Result.fail('This block is pinned. Unpin it before moving it.');
    }

    const ordered = [...blockLessons].sort(
      (a, b) => (grid.getSlot(a.slotId)?.periodIndex ?? 0) - (grid.getSlot(b.slotId)?.periodIndex ?? 0),
    );
    const size = ordered.length;
    const start = grid.getSlot(targetSlotId);
    if (!start) return Result.fail('That time slot does not exist.');

    // The target window must be one of the grid's genuine uninterrupted runs,
    // so a block can never be scheduled across recess.
    const window = this._context.windowsOfSize(size)
      .find((slots) => slots[0].id === targetSlotId);
    if (!window) {
      return Result.fail(`A ${size}-period block does not fit starting at ${start.shortLabel} — it would run past a break or the end of the day.`);
    }
    if (window.every((slot, index) => slot.id === ordered[index].slotId)) {
      return Result.fail('The block is already in those periods.');
    }

    const reference = ordered[0];
    const demand = this.demandFor(reference, size);
    const original = {
      demand,
      slots: ordered.map((lesson) => grid.getSlot(lesson.slotId)).filter(Boolean),
      teacherId: reference.teacherId,
    };
    const candidate = { demand, slots: window, teacherId: reference.teacherId };

    const result = this._checkWithout(original, candidate);
    return result.ok ? Result.ok({ slots: window }, result.warnings) : result;
  }

  /**
   * Can these two cells exchange contents?
   *
   * Both are lifted out first. Checking them one at a time would report a false
   * clash: A cannot move into B's slot while B is still sitting in it.
   *
   * @param {import('../domain/Lesson.js').Lesson} first
   * @param {import('../domain/Lesson.js').Lesson} second
   * @returns {Result}
   */
  validateSwap(first, second) {
    if (first.locked || second.locked) return Result.fail('One of those periods is pinned. Unpin it first.');

    const grid = this._context.timeGrid;
    const firstSlot = grid.getSlot(first.slotId);
    const secondSlot = grid.getSlot(second.slotId);
    if (!firstSlot || !secondSlot) return Result.fail('One of those time slots no longer exists.');

    const firstDemand = this.demandFor(first);
    const secondDemand = this.demandFor(second);

    const firstOriginal = { demand: firstDemand, slots: [firstSlot], teacherId: first.teacherId };
    const secondOriginal = { demand: secondDemand, slots: [secondSlot], teacherId: second.teacherId };

    this._state.unplace(firstOriginal);
    this._state.unplace(secondOriginal);

    const firstCandidate = { demand: firstDemand, slots: [secondSlot], teacherId: first.teacherId };
    const secondCandidate = { demand: secondDemand, slots: [firstSlot], teacherId: second.teacherId };

    let failure = this._registry.firstViolation(firstCandidate, this._state, this._context);
    if (!failure) {
      // Provisionally commit the first half so the second is checked against
      // the world it will actually land in.
      this._state.place(firstCandidate);
      failure = this._registry.firstViolation(secondCandidate, this._state, this._context);
      this._state.unplace(firstCandidate);
    }

    this._state.place(firstOriginal);
    this._state.place(secondOriginal);

    return failure
      ? Result.fail(failure.reason)
      : Result.ok({ firstCandidate, secondCandidate }, this._softAdvice(firstCandidate));
  }

  /**
   * Can this teacher take this lesson?
   * @param {import('../domain/Lesson.js').Lesson} lesson
   * @param {string|null} teacherId
   * @returns {Result}
   */
  validateTeacherAssignment(lesson, teacherId) {
    if (!teacherId) return Result.ok(null, ['This period will have no teacher assigned.']);

    const teacher = this._context.teacher(teacherId);
    if (!teacher) return Result.fail('That teacher no longer exists.');

    const slot = this._context.timeGrid.getSlot(lesson.slotId);
    if (!slot) return Result.fail('That time slot no longer exists.');

    const demand = this.demandFor(lesson);
    const original = { demand, slots: [slot], teacherId: lesson.teacherId };
    const candidate = { demand, slots: [slot], teacherId };

    const result = this._checkWithout(original, candidate);
    if (!result.ok) return result;

    const warnings = [...result.warnings];
    if (!teacher.subjectIds.includes(lesson.subjectId)) {
      const subjectName = this._context.subject(lesson.subjectId)?.name ?? 'this subject';
      warnings.push(`${teacher.name} is not listed as qualified for ${subjectName}.`);
    }
    return Result.ok(result.value, warnings);
  }

  /**
   * Can a brand-new lesson be created in an empty cell?
   * @param {string} classId
   * @param {string} slotId
   * @param {string} subjectId
   * @param {string|null} teacherId
   * @returns {Result}
   */
  validateInsert(classId, slotId, subjectId, teacherId) {
    const slot = this._context.timeGrid.getSlot(slotId);
    if (!slot) return Result.fail('That time slot does not exist.');

    const demand = this.demandFor({ classId, subjectId, teacherId, slotId, blockId: null, locked: false });
    const candidate = { demand, slots: [slot], teacherId };

    const failure = this._registry.firstViolation(candidate, this._state, this._context);
    return failure ? Result.fail(failure.reason) : Result.ok(candidate, this._softAdvice(candidate));
  }

  /**
   * Runs the hard rules for `candidate` while `original` is lifted out, then
   * always restores the state. The try/finally matters: an exception escaping
   * with the lesson still removed would silently delete it from the grid.
   *
   * @private
   * @param {object} original
   * @param {object} candidate
   * @returns {Result}
   */
  _checkWithout(original, candidate) {
    let failure = null;
    let advice = [];

    this._state.unplace(original);
    try {
      failure = this._registry.firstViolation(candidate, this._state, this._context);
      if (!failure) advice = this._softAdvice(candidate);
    } finally {
      this._state.place(original);
    }

    return failure ? Result.fail(failure.reason) : Result.ok(candidate, advice);
  }

  /**
   * Non-blocking notes about a legal-but-imperfect placement, so the
   * administrator sees "allowed, but this breaks the morning-core rule" rather
   * than a silent acceptance.
   * @private
   * @param {object} candidate
   * @returns {string[]}
   */
  _softAdvice(candidate) {
    const breakdown = this._registry.penaltyBreakdown(candidate, this._state, this._context);
    const notes = [];

    for (const constraint of this._registry.softConstraints) {
      const cost = breakdown.get(constraint.id);
      // Only mention preferences that were meaningfully compromised; every
      // placement scores a little against something.
      if (cost !== undefined && cost >= 5) notes.push(constraint.describe(candidate));
    }
    return notes;
  }
}

export class ValidationService {
  /**
   * @param {object} deps
   * @param {import('../scheduling/Scheduler.js').Scheduler} deps.scheduler
   */
  constructor({ scheduler }) {
    /** @private */ this._scheduler = scheduler;
  }

  /**
   * Opens a validation session for one timetable.
   * @param {import('../domain/SchoolData.js').SchoolData} schoolData
   * @param {import('../domain/Timetable.js').Timetable} timetable
   * @returns {ValidationSession}
   */
  createSession(schoolData, timetable) {
    return new ValidationSession({
      context: this._scheduler.createContext(schoolData),
      registry: this._scheduler.registry,
      timetable,
    });
  }

  /**
   * Data-quality problems worth showing before the user clicks Generate.
   * These are not scheduling failures — they are configuration mistakes that
   * would otherwise surface as a mysteriously incomplete timetable.
   *
   * @param {import('../domain/SchoolData.js').SchoolData} schoolData
   * @returns {Array<{level: 'danger'|'warning'|'info', message: string}>}
   */
  auditSchoolData(schoolData) {
    /** @type {Array<{level: 'danger'|'warning'|'info', message: string}>} */
    const findings = [];
    const capacity = schoolData.timeGrid.slotCount;

    const settingsCheck = schoolData.settings.validate();
    for (const error of settingsCheck.errors) findings.push({ level: 'danger', message: error });
    for (const warning of settingsCheck.warnings) findings.push({ level: 'warning', message: warning });

    if (schoolData.classes.size === 0) findings.push({ level: 'danger', message: 'No classes have been added yet.' });
    if (schoolData.subjects.size === 0) findings.push({ level: 'danger', message: 'No subjects have been added yet.' });
    if (schoolData.teachers.size === 0) findings.push({ level: 'danger', message: 'No teachers have been added yet.' });

    for (const schoolClass of schoolData.classes) {
      const demand = schoolData.demandForClass(schoolClass.id);
      if (demand === 0) {
        findings.push({ level: 'warning', message: `${schoolClass.name} has no subjects in its curriculum.` });
      } else if (demand > capacity) {
        findings.push({
          level: 'danger',
          message: `${schoolClass.name} needs ${demand} periods a week but the timetable only has ${capacity}. Reduce periods or add periods per day.`,
        });
      } else if (demand < capacity * 0.5) {
        findings.push({
          level: 'info',
          message: `${schoolClass.name} only fills ${demand} of ${capacity} periods, so over half the week will be free.`,
        });
      }
    }

    for (const teacher of schoolData.teachers) {
      const committed = schoolData.committedLoadForTeacher(teacher.id);
      if (committed > teacher.maxPeriodsPerWeek) {
        findings.push({
          level: 'danger',
          message: `${teacher.name} is assigned ${committed} periods a week but their limit is ${teacher.maxPeriodsPerWeek}.`,
        });
      }
      const unavailable = teacher.countUnavailable(schoolData.timeGrid.dayCount, schoolData.timeGrid.periodCount);
      if (committed > (capacity - unavailable)) {
        findings.push({
          level: 'danger',
          message: `${teacher.name} is assigned ${committed} periods but is only available for ${capacity - unavailable}.`,
        });
      }
    }

    for (const entry of schoolData.curriculum) {
      const className = schoolData.classes.get(entry.classId)?.name ?? entry.classId;
      const subjectName = schoolData.subjects.get(entry.subjectId)?.name ?? entry.subjectId;

      if (schoolData.eligibleTeachersFor(entry).length === 0) {
        findings.push({
          level: 'danger',
          message: `No teacher can take ${subjectName} for ${className}.`,
        });
      }
      if (entry.periodsPerWeek > entry.maxPerDay * schoolData.timeGrid.dayCount) {
        findings.push({
          level: 'danger',
          message: `${subjectName} for ${className} needs ${entry.periodsPerWeek} periods a week, but at ${entry.maxPerDay} per day over ${schoolData.timeGrid.dayCount} days only ${entry.maxPerDay * schoolData.timeGrid.dayCount} can be scheduled.`,
        });
      }
      const validation = entry.validate();
      for (const error of validation.errors) findings.push({ level: 'danger', message: `${className} / ${subjectName}: ${error}` });
    }

    return findings;
  }
}
