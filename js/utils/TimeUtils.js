/**
 * @file TimeUtils.js
 * @description Pure time arithmetic on "HH:MM" strings.
 *
 * The whole app stores clock times as 24-hour "HH:MM" strings because they are
 * timezone-free, human-readable in JSON, and trivially comparable. All maths
 * happens in minutes-since-midnight and converts back at the boundary.
 */

const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR;
const TIME_PATTERN = /^([01]?\d|2[0-3]):([0-5]\d)$/;

/**
 * Tests whether a string is a valid "HH:MM" 24-hour clock time.
 * @param {unknown} value
 * @returns {boolean}
 */
export function isValidTime(value) {
  return typeof value === 'string' && TIME_PATTERN.test(value.trim());
}

/**
 * Converts "HH:MM" to minutes since midnight.
 * @param {string} time
 * @returns {number} Minutes, or NaN when the input is malformed.
 */
export function toMinutes(time) {
  if (!isValidTime(time)) return Number.NaN;
  const [hours, minutes] = time.trim().split(':').map(Number);
  return hours * MINUTES_PER_HOUR + minutes;
}

/**
 * Converts minutes since midnight back to "HH:MM", wrapping past midnight.
 * @param {number} minutes
 * @returns {string}
 */
export function fromMinutes(minutes) {
  const normalised = ((Math.round(minutes) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const hours = Math.floor(normalised / MINUTES_PER_HOUR);
  const mins = normalised % MINUTES_PER_HOUR;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

/**
 * Adds minutes to a clock time.
 * @param {string} time
 * @param {number} minutes
 * @returns {string}
 */
export function addMinutes(time, minutes) {
  return fromMinutes(toMinutes(time) + minutes);
}

/**
 * Formats a slot as a readable range, e.g. "08:00 – 08:40".
 * @param {string} start
 * @param {string} end
 * @returns {string}
 */
export function formatRange(start, end) {
  return `${start} – ${end}`;
}

/**
 * Formats an ISO timestamp for display in the local timezone.
 * @param {string} isoString
 * @returns {string}
 */
export function formatTimestamp(isoString) {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

/**
 * Human-friendly elapsed time, e.g. "3 minutes ago".
 * @param {string} isoString
 * @returns {string}
 */
export function formatRelative(isoString) {
  const then = new Date(isoString).getTime();
  if (Number.isNaN(then)) return '—';

  const seconds = Math.round((Date.now() - then) / 1000);
  const table = [
    [60, 'second', 1],
    [3600, 'minute', 60],
    [86400, 'hour', 3600],
    [604800, 'day', 86400],
  ];

  for (const [limit, unit, divisor] of table) {
    if (seconds < limit) {
      const value = Math.max(1, Math.floor(seconds / divisor));
      return `${value} ${unit}${value === 1 ? '' : 's'} ago`;
    }
  }
  return formatTimestamp(isoString);
}

/**
 * Formats a duration in minutes as "1h 20m" / "40m".
 * @param {number} minutes
 * @returns {string}
 */
export function formatDuration(minutes) {
  const hours = Math.floor(minutes / MINUTES_PER_HOUR);
  const mins = minutes % MINUTES_PER_HOUR;
  if (hours === 0) return `${mins}m`;
  return mins === 0 ? `${hours}h` : `${hours}h ${mins}m`;
}
