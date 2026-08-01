/**
 * @file Logger.js
 * @description Namespaced console logging with a runtime-adjustable level.
 *
 * Wrapping console has one concrete payoff: a future backend build can point
 * this at a real sink without touching the 100+ call sites.
 */

/** @readonly @enum {number} */
export const LogLevel = Object.freeze({
  DEBUG: 10,
  INFO:  20,
  WARN:  30,
  ERROR: 40,
  SILENT: 100,
});

/** Module-private current threshold. */
let currentLevel = LogLevel.INFO;

/**
 * Sets the minimum level that will be emitted.
 * @param {number} level One of {@link LogLevel}.
 */
export function setLogLevel(level) {
  currentLevel = level;
}

/**
 * A logger bound to one module name.
 */
export class Logger {
  /** @param {string} namespace Short module name shown in every line. */
  constructor(namespace) {
    /** @private @type {string} */
    this._prefix = `[${namespace}]`;
  }

  /** @param {...unknown} args */
  debug(...args) { if (currentLevel <= LogLevel.DEBUG) console.debug(this._prefix, ...args); }

  /** @param {...unknown} args */
  info(...args) { if (currentLevel <= LogLevel.INFO) console.info(this._prefix, ...args); }

  /** @param {...unknown} args */
  warn(...args) { if (currentLevel <= LogLevel.WARN) console.warn(this._prefix, ...args); }

  /** @param {...unknown} args */
  error(...args) { if (currentLevel <= LogLevel.ERROR) console.error(this._prefix, ...args); }

  /**
   * Times a synchronous operation and logs the duration at debug level.
   * @template T
   * @param {string} label
   * @param {() => T} operation
   * @returns {T}
   */
  time(label, operation) {
    const started = performance.now();
    try {
      return operation();
    } finally {
      this.debug(`${label} took ${(performance.now() - started).toFixed(1)}ms`);
    }
  }
}

/**
 * Factory so call sites read `createLogger('Scheduler')` rather than `new`.
 * @param {string} namespace
 * @returns {Logger}
 */
export function createLogger(namespace) {
  return new Logger(namespace);
}
