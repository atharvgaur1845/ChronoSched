/**
 * @file SchoolClass.js
 * @description A teaching group — "10A", "12 Science".
 *
 * Named SchoolClass rather than Class: `Class` is technically a legal
 * identifier in JavaScript, but `import { Class } from './Class.js'` sitting
 * next to the `class` keyword is a permanent source of misreading.
 */

import { Entity } from '../core/Entity.js';
import { Result } from '../core/Result.js';

export class SchoolClass extends Entity {
  /**
   * @param {object} data
   * @param {string} data.id
   * @param {string} data.name          Display name, e.g. "10A" or "12 Science".
   * @param {number} [data.gradeLevel]  Numeric grade, used for sorting.
   * @param {string} [data.section]     Section letter, e.g. "A".
   * @param {number} [data.studentCount]
   * @param {string} [data.roomId]      Home room, reserved for a future room module.
   */
  constructor({ id, name, gradeLevel, section, studentCount, roomId }) {
    super(id);

    /** @type {string} */
    this.name = String(name ?? '').trim();
    /** @type {number} */
    this.gradeLevel = Number(gradeLevel ?? SchoolClass.deriveGradeLevel(this.name));
    /** @type {string} */
    this.section = String(section ?? SchoolClass.deriveSection(this.name)).trim();
    /** @type {number|null} */
    this.studentCount = studentCount === null || studentCount === undefined ? null : Number(studentCount);
    /** @type {string|null} */
    this.roomId = roomId ?? null;
  }

  /**
   * Extracts the leading number from a class name so "10A" sorts before "12 Science".
   * @param {string} name
   * @returns {number} 0 when no number is present.
   */
  static deriveGradeLevel(name) {
    const match = String(name).match(/\d+/);
    return match ? Number(match[0]) : 0;
  }

  /**
   * Extracts the non-numeric remainder as the section, e.g. "10A" → "A".
   * @param {string} name
   * @returns {string}
   */
  static deriveSection(name) {
    return String(name).replace(/^\s*\d+\s*/, '').trim();
  }

  /** @returns {string} */
  get displayName() {
    return this.name;
  }

  /**
   * Sort key giving natural grade-then-section ordering.
   * @returns {string}
   */
  get sortKey() {
    return `${String(this.gradeLevel).padStart(3, '0')}-${this.section}`;
  }

  /** @returns {Result} */
  validate() {
    const errors = [];
    if (this.name.length === 0) errors.push('Class name is required.');
    if (this.name.length > 40) errors.push('Class name must be 40 characters or fewer.');
    if (this.studentCount !== null && (!Number.isFinite(this.studentCount) || this.studentCount < 0)) {
      errors.push('Student count must be zero or a positive number.');
    }
    return errors.length > 0 ? Result.fail(errors) : Result.ok(this);
  }

  /** @returns {object} */
  toJSON() {
    return {
      id: this.id,
      name: this.name,
      gradeLevel: this.gradeLevel,
      section: this.section,
      studentCount: this.studentCount,
      roomId: this.roomId,
    };
  }
}
