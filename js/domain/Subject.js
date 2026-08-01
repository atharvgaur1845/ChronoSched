/**
 * @file Subject.js
 * @description A subject in the school's catalogue — "Mathematics", "Physics Lab".
 *
 * DELIBERATELY DOES NOT CONTAIN: which class studies it, how many periods it
 * needs, who teaches it, or when it should be scheduled. All of those vary per
 * class and therefore belong to {@link CurriculumEntry}. Keeping them here
 * would duplicate "Mathematics" once per class and make renaming it a
 * twelve-row edit.
 */

import { Entity } from '../core/Entity.js';
import { Result } from '../core/Result.js';
import { SubjectType, SUBJECT_COLOR_SLOTS } from '../utils/Constants.js';

export class Subject extends Entity {
  /**
   * @param {object} data
   * @param {string} data.id
   * @param {string} data.name       Full name, e.g. "Mathematics".
   * @param {string} [data.shortName] 3–4 letter grid label, e.g. "MAT".
   * @param {string} [data.type]     One of {@link SubjectType}.
   * @param {number} [data.difficulty] 1 (easy) – 5 (hard); drives even spreading.
   * @param {number} [data.colorSlot]  1–10; maps to a theme colour token.
   */
  constructor({ id, name, shortName, type, difficulty, colorSlot }) {
    super(id);

    /** @type {string} */
    this.name = String(name ?? '').trim();
    /** @type {string} */
    this.shortName = String(shortName ?? Subject.deriveShortName(this.name)).trim().toUpperCase();
    /** @type {string} */
    this.type = type ?? SubjectType.THEORY;
    /** @type {number} */
    this.difficulty = Number(difficulty ?? 3);
    /** @type {number} */
    this.colorSlot = Number(colorSlot ?? Subject.deriveColorSlot(this.name));
  }

  /**
   * Builds a grid abbreviation from a full name.
   * Multi-word names use initials ("Physical Education" → "PE"); single words
   * use the first three letters ("Mathematics" → "MAT").
   * @param {string} name
   * @returns {string}
   */
  static deriveShortName(name) {
    const words = String(name).trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return '—';
    if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
    return words.map((word) => word[0]).join('').slice(0, 4).toUpperCase();
  }

  /**
   * Deterministically picks a colour slot from the name, so the same subject
   * keeps the same colour across sessions without storing one.
   * @param {string} name
   * @returns {number} 1-based slot index.
   */
  static deriveColorSlot(name) {
    let hash = 0;
    for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
    return (hash % SUBJECT_COLOR_SLOTS) + 1;
  }

  /** @returns {boolean} */
  get isLab() {
    return this.type === SubjectType.LAB;
  }

  /** @returns {string} */
  get displayName() {
    return this.name;
  }

  /** @returns {string} CSS variable name for this subject's fill colour. */
  get fillVar() {
    return `var(--subject-${this.colorSlot})`;
  }

  /** @returns {string} CSS variable name for this subject's text colour. */
  get inkVar() {
    return `var(--subject-${this.colorSlot}-text)`;
  }

  /** @returns {Result} */
  validate() {
    const errors = [];
    if (this.name.length === 0) errors.push('Subject name is required.');
    if (this.name.length > 60) errors.push('Subject name must be 60 characters or fewer.');
    if (!Object.values(SubjectType).includes(this.type)) errors.push(`Unknown subject type "${this.type}".`);
    if (!Number.isFinite(this.difficulty) || this.difficulty < 1 || this.difficulty > 5) {
      errors.push('Difficulty must be a whole number from 1 to 5.');
    }
    return errors.length > 0 ? Result.fail(errors) : Result.ok(this);
  }

  /** @returns {object} */
  toJSON() {
    return {
      id: this.id,
      name: this.name,
      shortName: this.shortName,
      type: this.type,
      difficulty: this.difficulty,
      colorSlot: this.colorSlot,
    };
  }
}
