/**
 * @file SearchService.js
 * @description Cross-entity search over teachers, classes and subjects.
 *
 * Ranking, not just filtering: an exact match beats a prefix match, which beats
 * a match somewhere in the middle. With eighteen subjects that hardly matters;
 * with a real school's two hundred staff, typing "sha" and getting Shalini
 * before "Aisha Khan" is the difference between the box being useful and being
 * ignored.
 *
 * Deliberately synchronous and index-free. A linear scan over a few hundred
 * records is well under a millisecond, and a prebuilt index would need
 * invalidating on every edit — complexity bought with no measurable return.
 */

import { EntityKind, LIMITS } from '../utils/Constants.js';

/**
 * @typedef {object} SearchHit
 * @property {string} kind    One of {@link EntityKind}.
 * @property {string} id
 * @property {string} title
 * @property {string} subtitle
 * @property {number} score
 */

/** Score awarded for each quality of match. */
const SCORE = { EXACT: 100, PREFIX: 60, WORD_PREFIX: 40, CONTAINS: 20 };

export class SearchService {
  /**
   * @param {object} deps
   * @param {import('../data/DataService.js').DataService} deps.dataService
   */
  constructor({ dataService }) {
    /** @private */ this._dataService = dataService;
  }

  /** @private @returns {import('../domain/SchoolData.js').SchoolData} */
  get _schoolData() {
    return this._dataService.schoolData;
  }

  /**
   * Scores one candidate string against the query.
   * @private
   * @param {string} haystack
   * @param {string} needle Already lower-cased and trimmed.
   * @returns {number} 0 when there is no match.
   */
  static _score(haystack, needle) {
    const value = haystack.toLowerCase();
    if (value === needle) return SCORE.EXACT;
    if (value.startsWith(needle)) return SCORE.PREFIX;
    if (value.split(/[\s\-_/]+/).some((word) => word.startsWith(needle))) return SCORE.WORD_PREFIX;
    return value.includes(needle) ? SCORE.CONTAINS : 0;
  }

  /**
   * Best score across several searchable fields.
   * @private
   * @param {string[]} fields
   * @param {string} needle
   * @returns {number}
   */
  static _best(fields, needle) {
    let best = 0;
    for (const field of fields) {
      if (!field) continue;
      const score = SearchService._score(field, needle);
      if (score > best) best = score;
    }
    return best;
  }

  /**
   * Searches everything.
   * @param {string} query
   * @param {object} [options]
   * @param {number} [options.limit] Maximum hits per entity kind.
   * @returns {Array<{kind: string, label: string, hits: SearchHit[]}>}
   */
  search(query, { limit = LIMITS.SEARCH_RESULT_LIMIT } = {}) {
    const needle = String(query ?? '').trim().toLowerCase();
    if (needle.length === 0) return [];

    const schoolData = this._schoolData;

    /** @type {SearchHit[]} */
    const teachers = [];
    for (const teacher of schoolData.teachers) {
      const score = SearchService._best([teacher.name, teacher.employeeId], needle);
      if (score === 0) continue;

      const subjectNames = teacher.subjectIds
        .map((id) => schoolData.subjects.get(id)?.shortName)
        .filter(Boolean)
        .join(', ');

      teachers.push({
        kind: EntityKind.TEACHER,
        id: teacher.id,
        title: teacher.name,
        subtitle: [teacher.employeeId, subjectNames].filter(Boolean).join(' · ') || 'No subjects',
        score,
      });
    }

    /** @type {SearchHit[]} */
    const classes = [];
    for (const schoolClass of schoolData.classes) {
      const score = SearchService._best([schoolClass.name, schoolClass.section], needle);
      if (score === 0) continue;

      const demand = schoolData.demandForClass(schoolClass.id);
      classes.push({
        kind: EntityKind.CLASS,
        id: schoolClass.id,
        title: schoolClass.name,
        subtitle: `${demand} periods a week`,
        score,
      });
    }

    /** @type {SearchHit[]} */
    const subjects = [];
    for (const subject of schoolData.subjects) {
      const score = SearchService._best([subject.name, subject.shortName], needle);
      if (score === 0) continue;

      const usage = schoolData.curriculumForSubject(subject.id).length;
      subjects.push({
        kind: EntityKind.SUBJECT,
        id: subject.id,
        title: subject.name,
        subtitle: usage === 0 ? 'Not in any curriculum' : `Taught to ${usage} class${usage === 1 ? '' : 'es'}`,
        score,
      });
    }

    const byScore = (a, b) => b.score - a.score || a.title.localeCompare(b.title);

    return [
      { kind: EntityKind.TEACHER, label: 'Teachers', hits: teachers.sort(byScore).slice(0, limit) },
      { kind: EntityKind.CLASS, label: 'Classes', hits: classes.sort(byScore).slice(0, limit) },
      { kind: EntityKind.SUBJECT, label: 'Subjects', hits: subjects.sort(byScore).slice(0, limit) },
    ].filter((group) => group.hits.length > 0);
  }

  /**
   * Total number of hits, for the "no results" message.
   * @param {string} query
   * @returns {number}
   */
  countMatches(query) {
    return this.search(query).reduce((total, group) => total + group.hits.length, 0);
  }
}
