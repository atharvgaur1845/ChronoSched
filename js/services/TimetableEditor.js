/**
 * @file TimetableEditor.js
 * @description Coordinates manual timetable editing: validate → command →
 * history → persist.
 *
 * WHY A COORDINATOR RATHER THAN LETTING THE VIEW DO IT
 * Every edit needs the same four steps in the same order. Spread across the
 * grid view, a context menu and a keyboard handler, one of them eventually
 * forgets to persist, or validates after mutating. Centralising the sequence
 * means an edit is either completely applied or not applied at all, and the
 * view is left with nothing to get wrong.
 *
 * Persistence is deliberately fire-and-forget after the in-memory mutation:
 * the grid repaints immediately and a storage failure surfaces as a toast,
 * rather than the UI freezing on every drag.
 */

import { Result } from '../core/Result.js';
import { MoveLessonCommand } from '../commands/MoveLessonCommand.js';
import { SwapLessonsCommand } from '../commands/SwapLessonsCommand.js';
import { AssignTeacherCommand } from '../commands/AssignTeacherCommand.js';
import { ClearLessonCommand } from '../commands/ClearLessonCommand.js';
import { SetLessonCommand, ToggleLockCommand } from '../commands/SetLessonCommand.js';
import { Events } from '../utils/Constants.js';

export class TimetableEditor {
  /**
   * @param {object} deps
   * @param {import('../data/DataService.js').DataService} deps.dataService
   * @param {import('../data/repositories/TimetableRepository.js').TimetableRepository} deps.timetableRepository
   * @param {import('./ValidationService.js').ValidationService} deps.validationService
   * @param {import('../managers/UndoRedoManager.js').UndoRedoManager} deps.undoRedoManager
   * @param {import('../core/EventBus.js').EventBus} deps.eventBus
   */
  constructor({ dataService, timetableRepository, validationService, undoRedoManager, eventBus }) {
    /** @private */ this._dataService = dataService;
    /** @private */ this._timetables = timetableRepository;
    /** @private */ this._validation = validationService;
    /** @private */ this._history = undoRedoManager;
    /** @private */ this._eventBus = eventBus;

    /** @private @type {string|null} Version the current history belongs to. */
    this._historyOwnerId = null;
  }

  /** @returns {import('../domain/SchoolData.js').SchoolData} */
  get schoolData() {
    return this._dataService.schoolData;
  }

  /** @returns {import('../domain/Timetable.js').Timetable|null} */
  get timetable() {
    return this._timetables.getActive();
  }

  /**
   * Opens a validation session against the active version.
   * Views hold one for the duration of a drag and discard it afterwards.
   * @returns {import('./ValidationService.js').ValidationSession|null}
   */
  openSession() {
    const timetable = this.timetable;
    return timetable ? this._validation.createSession(this.schoolData, timetable) : null;
  }

  /**
   * All lessons that must move together with the given one.
   * @param {import('../domain/Lesson.js').Lesson} lesson
   * @returns {import('../domain/Lesson.js').Lesson[]}
   */
  groupFor(lesson) {
    const timetable = this.timetable;
    if (!timetable) return [lesson];
    return lesson.blockId ? timetable.lessonsInBlock(lesson.blockId) : [lesson];
  }

  /**
   * Moves a lesson (with its block, if any) to a new slot.
   * @param {import('../domain/Lesson.js').Lesson} lesson
   * @param {string} targetSlotId
   * @returns {Promise<Result>}
   */
  async move(lesson, targetSlotId) {
    const timetable = this.timetable;
    if (!timetable) return Result.fail('There is no timetable to edit.');

    const session = this._validation.createSession(this.schoolData, timetable);
    const group = this.groupFor(lesson);
    const grid = this.schoolData.timeGrid;

    let moves;
    let validation;

    if (group.length > 1) {
      validation = session.validateBlockMove(group, targetSlotId);
      if (!validation.ok) return validation;

      const ordered = [...group].sort(
        (a, b) => grid.getSlot(a.slotId).periodIndex - grid.getSlot(b.slotId).periodIndex,
      );
      moves = ordered.map((member, index) => ({
        lesson: member,
        targetSlotId: validation.value.slots[index].id,
      }));
    } else {
      validation = session.validateMove(lesson, targetSlotId);
      if (!validation.ok) return validation;
      moves = [{ lesson, targetSlotId }];
    }

    const targetSlot = grid.getSlot(targetSlotId);
    const subjectName = this.schoolData.subjects.get(lesson.subjectId)?.name ?? 'Lesson';
    const className = this.schoolData.classes.get(lesson.classId)?.name ?? '';

    return this._run(new MoveLessonCommand({
      timetable,
      moves,
      label: `Move ${subjectName} (${className}) to ${targetSlot.shortLabel}`,
    }), validation.warnings);
  }

  /**
   * Exchanges two lessons.
   * @param {import('../domain/Lesson.js').Lesson} first
   * @param {import('../domain/Lesson.js').Lesson} second
   * @returns {Promise<Result>}
   */
  async swap(first, second) {
    const timetable = this.timetable;
    if (!timetable) return Result.fail('There is no timetable to edit.');
    if (first.classId !== second.classId) {
      return Result.fail('Periods can only be swapped within the same class.');
    }
    if (first.blockId || second.blockId) {
      return Result.fail('Consecutive blocks cannot be swapped. Move the block instead.');
    }

    const session = this._validation.createSession(this.schoolData, timetable);
    const validation = session.validateSwap(first, second);
    if (!validation.ok) return validation;

    const nameOf = (lesson) => this.schoolData.subjects.get(lesson.subjectId)?.name ?? 'lesson';

    return this._run(new SwapLessonsCommand({
      timetable,
      first,
      second,
      label: `Swap ${nameOf(first)} and ${nameOf(second)}`,
    }), validation.warnings);
  }

  /**
   * Reassigns (or clears) the teacher on a lesson and its block.
   * @param {import('../domain/Lesson.js').Lesson} lesson
   * @param {string|null} teacherId
   * @returns {Promise<Result>}
   */
  async assignTeacher(lesson, teacherId) {
    const timetable = this.timetable;
    if (!timetable) return Result.fail('There is no timetable to edit.');

    const session = this._validation.createSession(this.schoolData, timetable);
    const validation = session.validateTeacherAssignment(lesson, teacherId);
    if (!validation.ok) return validation;

    const teacherName = teacherId
      ? this.schoolData.teachers.get(teacherId)?.name ?? 'teacher'
      : 'nobody';

    return this._run(new AssignTeacherCommand({
      timetable,
      lessons: this.groupFor(lesson),
      teacherId,
      label: `Assign ${teacherName}`,
    }), validation.warnings);
  }

  /**
   * Empties a cell (and its block).
   * @param {import('../domain/Lesson.js').Lesson} lesson
   * @returns {Promise<Result>}
   */
  async clear(lesson) {
    const timetable = this.timetable;
    if (!timetable) return Result.fail('There is no timetable to edit.');
    if (lesson.locked) return Result.fail('This period is pinned. Unpin it first.');

    const subjectName = this.schoolData.subjects.get(lesson.subjectId)?.name ?? 'lesson';
    return this._run(new ClearLessonCommand({
      timetable,
      lessons: this.groupFor(lesson),
      label: `Clear ${subjectName}`,
    }));
  }

  /**
   * Places a subject into a cell, replacing anything already there.
   * @param {string} classId
   * @param {string} slotId
   * @param {string} subjectId
   * @param {string|null} teacherId
   * @returns {Promise<Result>}
   */
  async setLesson(classId, slotId, subjectId, teacherId) {
    const timetable = this.timetable;
    if (!timetable) return Result.fail('There is no timetable to edit.');

    const session = this._validation.createSession(this.schoolData, timetable);
    const existing = timetable.getLesson(classId, slotId);
    if (existing?.locked) return Result.fail('This period is pinned. Unpin it first.');

    // Temporarily lift any occupant so the new subject is checked against the
    // world it will actually live in rather than clashing with what it replaces.
    let validation;
    if (existing) {
      const demand = session.demandFor(existing);
      const slot = this.schoolData.timeGrid.getSlot(slotId);
      session.state.unplace({ demand, slots: [slot], teacherId: existing.teacherId });
      validation = session.validateInsert(classId, slotId, subjectId, teacherId);
      session.state.place({ demand, slots: [slot], teacherId: existing.teacherId });
    } else {
      validation = session.validateInsert(classId, slotId, subjectId, teacherId);
    }
    if (!validation.ok) return validation;

    const subjectName = this.schoolData.subjects.get(subjectId)?.name ?? 'subject';
    const slotLabel = this.schoolData.timeGrid.getSlot(slotId)?.shortLabel ?? '';

    return this._run(new SetLessonCommand({
      timetable, classId, slotId, subjectId, teacherId,
      label: `Set ${subjectName} at ${slotLabel}`,
    }), validation.warnings);
  }

  /**
   * Pins or unpins a lesson so regeneration schedules around it.
   * @param {import('../domain/Lesson.js').Lesson} lesson
   * @returns {Promise<Result>}
   */
  async toggleLock(lesson) {
    const timetable = this.timetable;
    if (!timetable) return Result.fail('There is no timetable to edit.');

    const target = !lesson.locked;
    return this._run(new ToggleLockCommand({
      timetable,
      lessons: this.groupFor(lesson),
      locked: target,
      label: target ? 'Pin period' : 'Unpin period',
    }));
  }

  /** @returns {Promise<Result>} */
  async undo() {
    const result = this._history.undo();
    if (result.ok) await this._persist();
    return result;
  }

  /** @returns {Promise<Result>} */
  async redo() {
    const result = this._history.redo();
    if (result.ok) await this._persist();
    return result;
  }

  /**
   * Discards history when the user switches to a different version — replaying
   * a delta from version 2 against version 3 would corrupt it.
   * @param {string|null} timetableId
   */
  syncHistoryOwner(timetableId) {
    if (this._historyOwnerId === timetableId) return;
    this._historyOwnerId = timetableId;
    this._history.clear();
  }

  /**
   * @private
   * @param {import('../core/Command.js').Command} command
   * @param {string[]} [warnings]
   * @returns {Promise<Result>}
   */
  async _run(command, warnings = []) {
    this.syncHistoryOwner(this.timetable?.id ?? null);

    const result = this._history.run(command);
    if (!result.ok) return result;

    await this._persist();
    return Result.ok(result.value, warnings);
  }

  /**
   * @private
   * @returns {Promise<void>}
   */
  async _persist() {
    const timetable = this.timetable;
    if (!timetable) return;

    const result = await this._timetables.saveEdits(timetable);
    if (!result.ok) {
      this._eventBus.emit(Events.TOAST, { level: 'danger', message: result.message });
    }
  }
}
