/**
 * @file Entity.js
 * @description Abstract base for every persisted domain object.
 *
 * Provides the three things all entities share — identity, a serialisation
 * contract, and a validation contract — and nothing else. Subclasses stay free
 * of boilerplate while the data layer can treat them uniformly.
 *
 * Deliberately NOT provided here: persistence, change notification, or any
 * knowledge of repositories. An entity that can save itself is an entity that
 * cannot be unit-tested (Single Responsibility).
 */

import { Result } from './Result.js';

export class Entity {
  /**
   * @param {string} id Stable unique identifier.
   */
  constructor(id) {
    if (new.target === Entity) {
      throw new TypeError('Entity is abstract and cannot be instantiated directly.');
    }
    if (typeof id !== 'string' || id.length === 0) {
      throw new TypeError(`${new.target.name} requires a non-empty string id.`);
    }
    /** @type {string} */
    this.id = id;
  }

  /**
   * Identity comparison. Two entities are the same entity when their ids match,
   * regardless of field values — that is what "identity" means.
   * @param {Entity|null|undefined} other
   * @returns {boolean}
   */
  equals(other) {
    return other instanceof Entity && other.constructor === this.constructor && other.id === this.id;
  }

  /**
   * Short label for dropdowns, toasts and search results.
   * @abstract
   * @returns {string}
   */
  get displayName() {
    return this.id;
  }

  /**
   * Serialises to a plain JSON-safe object.
   * @abstract
   * @returns {object}
   */
  toJSON() {
    throw new Error(`${this.constructor.name} must implement toJSON().`);
  }

  /**
   * Checks the entity's own invariants — those that need no other entity.
   * Cross-entity rules (does this teacher exist? is this subject assigned
   * twice?) belong in ValidationService, not here.
   * @returns {Result}
   */
  validate() {
    return Result.ok(this);
  }

  /**
   * Returns a copy with the given fields replaced.
   *
   * Editing goes through here rather than through direct mutation so that the
   * undo/redo commands always have a distinct "before" object to restore.
   * @param {object} changes
   * @returns {this}
   */
  withChanges(changes) {
    const Constructor = /** @type {typeof Entity & (new (data: object) => Entity)} */ (this.constructor);
    return /** @type {this} */ (new Constructor({ ...this.toJSON(), ...changes }));
  }
}
