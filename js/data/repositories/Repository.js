/**
 * @file Repository.js
 * @description Generic CRUD over one in-memory {@link Registry}, with
 * persistence and change notification attached.
 *
 * SEPARATION THIS BUYS
 *   Registry   — collection semantics (lookup, ordering). Knows nothing else.
 *   Repository — validation gate, persistence, change events.
 *   DataService— where the bytes actually go.
 * Each can be replaced without touching the other two.
 *
 * The registry is resolved through a selector rather than captured in the
 * constructor, because DataService swaps the whole SchoolData instance on
 * import and reset. A captured reference would silently point at the old data.
 *
 * @template {{id: string, toJSON: () => object, validate: () => import('../../core/Result.js').Result}} T
 */

import { Result } from '../../core/Result.js';
import { createLogger } from '../../utils/Logger.js';

const log = createLogger('Repository');

export class Repository {
  /**
   * @param {object} deps
   * @param {import('../DataService.js').DataService} deps.dataService
   * @param {import('../../core/EventBus.js').EventBus} deps.eventBus
   * @param {string} deps.storageKey    Where this collection is persisted.
   * @param {string} deps.changeEvent   Event emitted after every mutation.
   * @param {(schoolData: import('../../domain/SchoolData.js').SchoolData) => import('../../core/Registry.js').Registry<T>} deps.selector
   * @param {(data: object) => T} deps.factory Rebuilds an entity from plain data.
   * @param {string} deps.label         Human name used in messages, e.g. "Teacher".
   */
  constructor({ dataService, eventBus, storageKey, changeEvent, selector, factory, label }) {
    /** @protected */ this._dataService = dataService;
    /** @protected */ this._eventBus = eventBus;
    /** @protected */ this._storageKey = storageKey;
    /** @protected */ this._changeEvent = changeEvent;
    /** @protected */ this._selector = selector;
    /** @protected */ this._factory = factory;
    /** @protected */ this._label = label;
  }

  /**
   * @protected
   * @returns {import('../../core/Registry.js').Registry<T>}
   */
  get _registry() {
    return this._selector(this._dataService.schoolData);
  }

  /** @protected @returns {import('../../domain/SchoolData.js').SchoolData} */
  get _schoolData() {
    return this._dataService.schoolData;
  }

  /** @returns {number} */
  get count() {
    return this._registry.size;
  }

  /** @returns {T[]} */
  getAll() {
    return this._registry.toArray();
  }

  /**
   * @param {string} id
   * @returns {T|undefined}
   */
  getById(id) {
    return this._registry.get(id);
  }

  /**
   * @param {string} id
   * @returns {boolean}
   */
  exists(id) {
    return this._registry.has(id);
  }

  /**
   * Builds an entity from plain data without storing it. Used by editors to
   * validate a draft before the user commits.
   * @param {object} data
   * @returns {T}
   */
  build(data) {
    return this._factory(data);
  }

  /**
   * Validates and inserts a new entity.
   * @param {T} entity
   * @returns {Promise<Result>} On success, `value` is the stored entity.
   */
  async add(entity) {
    const validation = this._validateForWrite(entity, /* isUpdate */ false);
    if (!validation.ok) return validation;

    this._registry.set(entity);
    await this._commit();
    return Result.ok(entity, validation.warnings);
  }

  /**
   * Validates and replaces an existing entity.
   * @param {T} entity
   * @returns {Promise<Result>}
   */
  async update(entity) {
    if (!this._registry.has(entity.id)) {
      return Result.fail(`${this._label} no longer exists — it may have been deleted in another tab.`);
    }
    const validation = this._validateForWrite(entity, /* isUpdate */ true);
    if (!validation.ok) return validation;

    this._registry.set(entity);
    await this._commit();
    return Result.ok(entity, validation.warnings);
  }

  /**
   * Deletes an entity after checking nothing depends on it.
   * @param {string} id
   * @returns {Promise<Result>}
   */
  async remove(id) {
    const entity = this._registry.get(id);
    if (!entity) return Result.fail(`${this._label} not found.`);

    const blockers = this._findDependents(entity);
    if (blockers.length > 0) return Result.fail(blockers);

    await this._beforeRemove(entity);
    this._registry.delete(id);
    await this._commit();
    return Result.ok(entity);
  }

  /**
   * Replaces the whole collection in one transaction. Used by import.
   * @param {T[]} entities
   * @returns {Promise<Result>}
   */
  async replaceAll(entities) {
    const validations = entities.map((entity) => entity.validate());
    const combined = Result.all(validations);
    if (!combined.ok) return combined;

    this._registry.replaceAll(entities);
    await this._commit();
    return Result.ok(entities, combined.warnings);
  }

  /**
   * Persists and announces the change. Every mutating path ends here, which is
   * why no caller ever has to remember to save.
   * @protected
   * @returns {Promise<void>}
   */
  async _commit() {
    const payload = this._registry.map((entity) => entity.toJSON());
    await this._dataService.persist(this._storageKey, payload);
    this._eventBus.emit(this._changeEvent, this._registry.toArray());
  }

  /**
   * Entity-level validation plus repository-level uniqueness rules.
   * @protected
   * @param {T} entity
   * @param {boolean} isUpdate
   * @returns {Result}
   */
  _validateForWrite(entity, isUpdate) {
    const own = entity.validate();
    if (!own.ok) return own;

    const conflicts = this._findConflicts(entity, isUpdate);
    return conflicts.length > 0 ? Result.fail(conflicts, own.warnings) : Result.ok(entity, own.warnings);
  }

  /**
   * Uniqueness / cross-entity write rules. Subclasses override.
   * @protected
   * @param {T} _entity
   * @param {boolean} _isUpdate
   * @returns {string[]} Blocking messages; empty means "allowed".
   */
  _findConflicts(_entity, _isUpdate) {
    return [];
  }

  /**
   * Referential-integrity check run before deletion. Subclasses override to
   * refuse deletes that would orphan other records.
   * @protected
   * @param {T} _entity
   * @returns {string[]} Blocking messages; empty means "allowed".
   */
  _findDependents(_entity) {
    return [];
  }

  /**
   * Cascade hook: clean up dependents that should follow the entity out.
   * @protected
   * @param {T} _entity
   * @returns {Promise<void>}
   */
  async _beforeRemove(_entity) {
    log.debug(`Removing ${this._label} ${_entity.id}`);
  }
}
