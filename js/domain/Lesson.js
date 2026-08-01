/**
 * @file Lesson.js
 * @description One subject taught to one class in one time slot — a single
 * cell of the timetable grid.
 *
 * Lesson is a VALUE OBJECT, not an Entity: it has no independent identity.
 * Its identity is entirely (classId, slotId) — a class can only be doing one
 * thing at a time, so that pair is naturally unique. Giving it a random id
 * would let two lessons claim the same cell without anything noticing.
 */

/**
 * Separator used in composite keys. Chosen because ids never contain it.
 * @private
 */
const KEY_SEP = '|';

export class Lesson {
  /**
   * @param {object} data
   * @param {string} data.slotId
   * @param {string} data.classId
   * @param {string} data.subjectId
   * @param {string|null} [data.teacherId]
   * @param {boolean} [data.locked]   Manual edits survive regeneration when true.
   * @param {string|null} [data.blockId] Groups the periods of one consecutive block.
   */
  constructor({ slotId, classId, subjectId, teacherId, locked, blockId }) {
    /** @type {string} */
    this.slotId = slotId;
    /** @type {string} */
    this.classId = classId;
    /** @type {string} */
    this.subjectId = subjectId;
    /** @type {string|null} */
    this.teacherId = teacherId ?? null;
    /** @type {boolean} */
    this.locked = Boolean(locked);
    /** @type {string|null} */
    this.blockId = blockId ?? null;

    Object.freeze(this);
  }

  /**
   * Key identifying the grid cell this lesson occupies.
   * @param {string} classId
   * @param {string} slotId
   * @returns {string}
   */
  static cellKey(classId, slotId) {
    return `${classId}${KEY_SEP}${slotId}`;
  }

  /**
   * Key identifying a teacher's occupancy of a slot.
   * @param {string} teacherId
   * @param {string} slotId
   * @returns {string}
   */
  static teacherKey(teacherId, slotId) {
    return `${teacherId}${KEY_SEP}${slotId}`;
  }

  /** @returns {string} */
  get cellKey() {
    return Lesson.cellKey(this.classId, this.slotId);
  }

  /** @returns {boolean} True when this lesson is one period of a larger block. */
  get isBlockMember() {
    return this.blockId !== null;
  }

  /**
   * Returns a copy with the given fields replaced. Lessons are frozen, so all
   * editing goes through here — which is what makes undo trivially correct.
   * @param {object} changes
   * @returns {Lesson}
   */
  withChanges(changes) {
    return new Lesson({ ...this.toJSON(), ...changes });
  }

  /** @returns {object} */
  toJSON() {
    return {
      slotId: this.slotId,
      classId: this.classId,
      subjectId: this.subjectId,
      teacherId: this.teacherId,
      locked: this.locked,
      blockId: this.blockId,
    };
  }
}
