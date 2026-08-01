/**
 * @file UndoRedoManager.js
 * @description Two stacks of {@link Command} objects.
 *
 * WHY COMMANDS AND NOT SNAPSHOTS
 * Snapshotting the whole timetable per edit costs O(lessons) memory per step
 * and yields a history of indistinguishable "change" entries. A command stores
 * only its delta, so a 100-step history is a few kilobytes, and it carries a
 * label so the status bar can say exactly what Ctrl+Z will undo.
 *
 * THE REDO RULE
 * Performing a new action after undoing clears the redo stack. This is what
 * every editor does, and the alternative — branching history — is a feature no
 * administrator has asked for and every one of them would find confusing.
 */

import { Command } from '../core/Command.js';
import { Events, LIMITS } from '../utils/Constants.js';
import { Result } from '../core/Result.js';
import { createLogger } from '../utils/Logger.js';

const log = createLogger('UndoRedoManager');

export class UndoRedoManager {
  /**
   * @param {object} deps
   * @param {import('../core/EventBus.js').EventBus} deps.eventBus
   * @param {number} [deps.maxDepth]
   */
  constructor({ eventBus, maxDepth = LIMITS.MAX_UNDO_DEPTH }) {
    /** @private */ this._eventBus = eventBus;
    /** @private */ this._maxDepth = maxDepth;
    /** @private @type {Command[]} */ this._undoStack = [];
    /** @private @type {Command[]} */ this._redoStack = [];
  }

  /** @returns {boolean} */
  get canUndo() { return this._undoStack.length > 0; }

  /** @returns {boolean} */
  get canRedo() { return this._redoStack.length > 0; }

  /** @returns {string|null} Label of the action Ctrl+Z would reverse. */
  get undoLabel() { return this._undoStack.at(-1)?.label ?? null; }

  /** @returns {string|null} Label of the action Ctrl+Y would repeat. */
  get redoLabel() { return this._redoStack.at(-1)?.label ?? null; }

  /** @returns {number} */
  get depth() { return this._undoStack.length; }

  /**
   * Executes a command and pushes it onto the history.
   *
   * A command that fails is NOT pushed — undoing something that never happened
   * would corrupt the timetable, and that failure mode is silent and awful.
   *
   * @param {Command} command
   * @returns {Result}
   */
  run(command) {
    if (!(command instanceof Command)) {
      throw new TypeError('UndoRedoManager.run() expects a Command.');
    }
    if (!command.canExecute()) {
      return Result.fail(`"${command.label}" cannot be applied right now.`);
    }

    const result = command.execute();
    if (!result.ok) return result;

    command.setExecuted(true);

    // Consecutive edits to the same cell collapse into one history entry, so
    // nudging a lesson three times is one Ctrl+Z, not three.
    const previous = this._undoStack.at(-1);
    const merged = previous ? command.mergeWith(previous) : null;
    if (merged) this._undoStack[this._undoStack.length - 1] = merged;
    else this._undoStack.push(command);

    if (this._undoStack.length > this._maxDepth) this._undoStack.shift();

    this._redoStack.length = 0;
    this._notify();
    return result;
  }

  /**
   * Reverses the most recent command.
   * @returns {Result}
   */
  undo() {
    const command = this._undoStack.pop();
    if (!command) return Result.fail('There is nothing to undo.');

    const result = command.undo();
    if (!result.ok) {
      // Put it back: a half-undone command must stay on the stack, otherwise
      // the history no longer describes the actual state.
      this._undoStack.push(command);
      log.error(`Undo of "${command.label}" failed.`, result.errors);
      return result;
    }

    command.setExecuted(false);
    this._redoStack.push(command);
    this._notify();
    return Result.ok(command.label);
  }

  /**
   * Re-applies the most recently undone command.
   * @returns {Result}
   */
  redo() {
    const command = this._redoStack.pop();
    if (!command) return Result.fail('There is nothing to redo.');

    const result = command.execute();
    if (!result.ok) {
      this._redoStack.push(command);
      log.error(`Redo of "${command.label}" failed.`, result.errors);
      return result;
    }

    command.setExecuted(true);
    this._undoStack.push(command);
    this._notify();
    return Result.ok(command.label);
  }

  /**
   * Empties both stacks. Called when the edited timetable changes — history
   * from a different version would apply its deltas to the wrong grid.
   */
  clear() {
    this._undoStack.length = 0;
    this._redoStack.length = 0;
    this._notify();
  }

  /**
   * Recent history, newest first, for a future "history panel".
   * @param {number} [limit]
   * @returns {string[]}
   */
  recentLabels(limit = 10) {
    return this._undoStack.slice(-limit).reverse().map((command) => command.label);
  }

  /** @private */
  _notify() {
    this._eventBus.emit(Events.HISTORY_CHANGED, {
      canUndo: this.canUndo,
      canRedo: this.canRedo,
      undoLabel: this.undoLabel,
      redoLabel: this.redoLabel,
      depth: this.depth,
    });
  }
}
