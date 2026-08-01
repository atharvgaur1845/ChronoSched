/**
 * @file Result.js
 * @description An explicit success/failure value.
 *
 * WHY NOT EXCEPTIONS
 * "This teacher already has a class at that time" is an expected outcome of a
 * drag-and-drop, not an exceptional condition. Modelling it as a thrown Error
 * means every caller must remember a try/catch, and forgetting one produces a
 * blank screen. A Result forces the caller to look at `ok` before using `value`,
 * and lets validation collect *all* failures rather than only the first.
 *
 * Exceptions remain reserved for genuine programmer errors (bad arguments,
 * impossible states).
 */

export class Result {
  /**
   * @private Use {@link Result.ok} or {@link Result.fail}.
   * @param {boolean} ok
   * @param {*} value
   * @param {string[]} errors
   * @param {string[]} warnings
   */
  constructor(ok, value, errors, warnings) {
    /** @type {boolean} True when the operation succeeded. */
    this.ok = ok;
    /** @type {*} The produced value. Only meaningful when `ok` is true. */
    this.value = value;
    /** @type {string[]} Human-readable failure reasons. */
    this.errors = errors;
    /** @type {string[]} Non-blocking advisories; present on success too. */
    this.warnings = warnings;
    Object.freeze(this);
  }

  /**
   * Builds a success result.
   * @param {*} [value]
   * @param {string[]} [warnings]
   * @returns {Result}
   */
  static ok(value = null, warnings = []) {
    return new Result(true, value, [], warnings);
  }

  /**
   * Builds a failure result.
   * @param {string|string[]} errors
   * @param {string[]} [warnings]
   * @returns {Result}
   */
  static fail(errors, warnings = []) {
    return new Result(false, null, Array.isArray(errors) ? errors : [errors], warnings);
  }

  /**
   * Combines many results: fails if any failed, merging all messages.
   * Lets a form report every problem at once instead of one per submit.
   * @param {Result[]} results
   * @returns {Result} On success, `value` is the array of inner values.
   */
  static all(results) {
    const errors = results.flatMap((result) => result.errors);
    const warnings = results.flatMap((result) => result.warnings);
    return errors.length > 0
      ? Result.fail(errors, warnings)
      : Result.ok(results.map((result) => result.value), warnings);
  }

  /**
   * Transforms the contained value when successful.
   * @param {(value: *) => *} transform
   * @returns {Result}
   */
  map(transform) {
    return this.ok ? Result.ok(transform(this.value), this.warnings) : this;
  }

  /**
   * Returns the value on success, or the supplied fallback on failure.
   * @param {*} fallback
   * @returns {*}
   */
  orElse(fallback) {
    return this.ok ? this.value : fallback;
  }

  /**
   * All messages joined for display in a toast or alert.
   * @returns {string}
   */
  get message() {
    return [...this.errors, ...this.warnings].join(' ');
  }
}
