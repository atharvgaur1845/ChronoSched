/**
 * @file Command.js
 * @description Abstract base for every undoable operation (Command pattern).
 *
 * WHY COMMANDS RATHER THAN STATE SNAPSHOTS
 * Snapshotting the whole timetable on each edit is simpler, but it costs
 * O(lessons) memory per step and produces a useless history ("Undo change").
 * A command stores only the delta, so a 100-deep history is cheap, and it
 * carries a human label so the status bar can say
 * "Undo: Move Mathematics 10A Mon P3 → Tue P2".
 *
 * Contract: `undo()` must exactly reverse `execute()`. A command that cannot
 * guarantee that must not be pushed onto the history stack.
 */

export class Command {
  /**
   * @param {string} label Human-readable description, shown in the UI.
   */
  constructor(label) {
    if (new.target === Command) {
      throw new TypeError('Command is abstract and cannot be instantiated directly.');
    }
    /** @type {string} */
    this.label = label;
    /** @private @type {boolean} Guards against double-execute / double-undo. */
    this._executed = false;
  }

  /**
   * Applies the change.
   * @abstract
   * @returns {import('./Result.js').Result}
   */
  execute() {
    throw new Error(`${this.constructor.name} must implement execute().`);
  }

  /**
   * Reverses the change applied by {@link execute}.
   * @abstract
   * @returns {import('./Result.js').Result}
   */
  undo() {
    throw new Error(`${this.constructor.name} must implement undo().`);
  }

  /**
   * Whether this command can currently be executed. UndoRedoManager checks
   * this before running, so a command may refuse in a state it cannot handle.
   * @returns {boolean}
   */
  canExecute() {
    return true;
  }

  /**
   * Optional merge with the immediately previous command, so that (for example)
   * dragging a lesson twice in a row collapses into one undo step.
   * @param {Command} _previous
   * @returns {Command|null} Merged command, or null when no merge applies.
   */
  mergeWith(_previous) {
    return null;
  }

  /** @returns {boolean} */
  get isExecuted() {
    return this._executed;
  }

  /**
   * @protected Marks execution state; called by UndoRedoManager.
   * @param {boolean} executed
   */
  setExecuted(executed) {
    this._executed = executed;
  }
}
