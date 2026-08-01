/**
 * @file Timetable.js
 * @description One generated version of the school timetable.
 *
 * VERSIONING POLICY
 * Generation never overwrites: `Scheduler.generate()` always produces a new
 * Timetable with the next version number, and TimetableRepository is
 * append-only. Manual drag-and-drop edits, by contrast, DO mutate the version
 * being edited — that is what a user expects when they drag a cell, and undo
 * covers the mistake case. The two paths are deliberately different, and this
 * class is the only place that knows it.
 *
 * Lookups are backed by two maps rebuilt on every mutation, because the grid
 * renderer asks "what is in this cell?" once per cell per repaint.
 */

import { Lesson } from './Lesson.js';
import { createId } from '../utils/IdGenerator.js';
import { groupBy } from '../utils/ArrayUtils.js';

export class Timetable {
  /**
   * @param {object} data
   * @param {string} [data.id]
   * @param {number} data.version        1-based, unique within the repository.
   * @param {string} [data.label]        Admin-editable name for this version.
   * @param {string} [data.createdAt]    ISO timestamp.
   * @param {string} [data.strategyId]   Which algorithm produced it.
   * @param {string} [data.settingsHash] Geometry fingerprint at generation time.
   * @param {Array<object|Lesson>} [data.lessons]
   * @param {object} [data.report]       Plain report payload from the scheduler.
   */
  constructor({ id, version, label, createdAt, strategyId, settingsHash, lessons, report }) {
    /** @type {string} */
    this.id = id ?? createId('ttb');
    /** @type {number} */
    this.version = Number(version ?? 1);
    /** @type {string} */
    this.label = label ?? `Version ${this.version}`;
    /** @type {string} */
    this.createdAt = createdAt ?? new Date().toISOString();
    /** @type {string} */
    this.strategyId = strategyId ?? 'manual';
    /** @type {string} */
    this.settingsHash = settingsHash ?? '';
    /** @type {object} */
    this.report = report ?? { placed: 0, unplaced: [], softScore: 0, violations: [] };

    /** @private @type {Lesson[]} */
    this._lessons = (lessons ?? []).map((item) => (item instanceof Lesson ? item : new Lesson(item)));

    /** @private @type {Map<string, Lesson>} classId|slotId → lesson */
    this._byCell = new Map();
    /** @private @type {Map<string, Lesson>} teacherId|slotId → lesson */
    this._byTeacherSlot = new Map();

    this._reindex();
  }

  /**
   * Rebuilds the lookup maps. O(n) and called only on structural change, not
   * on read.
   * @private
   */
  _reindex() {
    this._byCell.clear();
    this._byTeacherSlot.clear();
    for (const lesson of this._lessons) {
      this._byCell.set(lesson.cellKey, lesson);
      if (lesson.teacherId) {
        this._byTeacherSlot.set(Lesson.teacherKey(lesson.teacherId, lesson.slotId), lesson);
      }
    }
  }

  /** @returns {Lesson[]} Defensive copy. */
  get lessons() {
    return [...this._lessons];
  }

  /** @returns {number} */
  get lessonCount() {
    return this._lessons.length;
  }

  /** @returns {number} Count of manually pinned lessons. */
  get lockedCount() {
    return this._lessons.reduce((total, lesson) => total + (lesson.locked ? 1 : 0), 0);
  }

  /** @returns {string} */
  get displayName() {
    return this.label;
  }

  /**
   * @param {string} classId
   * @param {string} slotId
   * @returns {Lesson|undefined}
   */
  getLesson(classId, slotId) {
    return this._byCell.get(Lesson.cellKey(classId, slotId));
  }

  /**
   * @param {string} teacherId
   * @param {string} slotId
   * @returns {Lesson|undefined}
   */
  getTeacherLesson(teacherId, slotId) {
    return this._byTeacherSlot.get(Lesson.teacherKey(teacherId, slotId));
  }

  /**
   * @param {string} classId
   * @returns {Lesson[]}
   */
  lessonsForClass(classId) {
    return this._lessons.filter((lesson) => lesson.classId === classId);
  }

  /**
   * @param {string} teacherId
   * @returns {Lesson[]}
   */
  lessonsForTeacher(teacherId) {
    return this._lessons.filter((lesson) => lesson.teacherId === teacherId);
  }

  /**
   * All lessons belonging to the same consecutive block.
   * @param {string|null} blockId
   * @returns {Lesson[]}
   */
  lessonsInBlock(blockId) {
    if (!blockId) return [];
    return this._lessons.filter((lesson) => lesson.blockId === blockId);
  }

  /**
   * Periods scheduled per teacher — the workload column of the reports.
   * @returns {Map<string, number>}
   */
  teacherLoads() {
    const loads = new Map();
    for (const lesson of this._lessons) {
      if (!lesson.teacherId) continue;
      loads.set(lesson.teacherId, (loads.get(lesson.teacherId) ?? 0) + 1);
    }
    return loads;
  }

  /**
   * Periods scheduled per (class, subject) — used to verify weekly quotas.
   * @returns {Map<string, number>}
   */
  subjectCounts() {
    const counts = new Map();
    for (const lesson of this._lessons) {
      const key = `${lesson.classId}::${lesson.subjectId}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }

  /** @returns {Map<string, Lesson[]>} classId → its lessons. */
  groupByClass() {
    return groupBy(this._lessons, (lesson) => lesson.classId);
  }

  // ---------------------------------------------------------------- mutation

  /**
   * Places a lesson, replacing whatever occupied that cell.
   * @param {Lesson} lesson
   */
  place(lesson) {
    const existing = this._byCell.get(lesson.cellKey);
    if (existing) this._removeInstance(existing);
    this._lessons.push(lesson);
    this._byCell.set(lesson.cellKey, lesson);
    if (lesson.teacherId) {
      this._byTeacherSlot.set(Lesson.teacherKey(lesson.teacherId, lesson.slotId), lesson);
    }
  }

  /**
   * Empties a cell.
   * @param {string} classId
   * @param {string} slotId
   * @returns {Lesson|null} The removed lesson, so a command can restore it.
   */
  remove(classId, slotId) {
    const lesson = this._byCell.get(Lesson.cellKey(classId, slotId));
    if (!lesson) return null;
    this._removeInstance(lesson);
    return lesson;
  }

  /**
   * @private
   * @param {Lesson} lesson
   */
  _removeInstance(lesson) {
    const index = this._lessons.indexOf(lesson);
    if (index >= 0) this._lessons.splice(index, 1);
    this._byCell.delete(lesson.cellKey);
    if (lesson.teacherId) {
      this._byTeacherSlot.delete(Lesson.teacherKey(lesson.teacherId, lesson.slotId));
    }
  }

  /**
   * Replaces the whole lesson set — used by undo when restoring a snapshot.
   * @param {Array<object|Lesson>} lessons
   */
  replaceLessons(lessons) {
    this._lessons = lessons.map((item) => (item instanceof Lesson ? item : new Lesson(item)));
    this._reindex();
  }

  /**
   * Creates an independent copy under a new version number. Used by
   * "duplicate version" and by any edit flow that must not touch the original.
   * @param {number} version
   * @param {string} [label]
   * @returns {Timetable}
   */
  cloneAsVersion(version, label) {
    return new Timetable({
      version,
      label: label ?? `Version ${version} (copy of ${this.label})`,
      strategyId: this.strategyId,
      settingsHash: this.settingsHash,
      lessons: this._lessons.map((lesson) => lesson.toJSON()),
      report: { ...this.report },
    });
  }

  /** @returns {object} */
  toJSON() {
    return {
      id: this.id,
      version: this.version,
      label: this.label,
      createdAt: this.createdAt,
      strategyId: this.strategyId,
      settingsHash: this.settingsHash,
      report: this.report,
      lessons: this._lessons.map((lesson) => lesson.toJSON()),
    };
  }
}
