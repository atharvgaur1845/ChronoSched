/**
 * @file TeacherClashConstraint.js
 * @description HARD — a teacher cannot take two classes at the same time.
 *
 * Together with ClassClashConstraint this is the pair that makes a timetable a
 * timetable rather than a wish list.
 */

import { IConstraint } from '../IConstraint.js';

export class TeacherClashConstraint extends IConstraint {
  /** @returns {string} */
  get id() { return 'teacher-clash'; }

  /**
   * @param {import('../../Placement.js').Placement} placement
   * @param {import('../../ScheduleState.js').ScheduleState} state
   * @returns {boolean}
   */
  isSatisfied(placement, state) {
    const { teacherId } = placement;
    // An unassigned period cannot clash with anyone. The scheduler reports the
    // missing teacher separately rather than rejecting the placement here.
    if (!teacherId) return true;

    for (const slot of placement.slots) {
      if (!state.isTeacherFree(teacherId, slot.id)) return false;
    }
    return true;
  }

  /**
   * @param {import('../../Placement.js').Placement} placement
   * @param {import('../../ScheduleState.js').ScheduleState} state
   * @param {import('../../SchedulingContext.js').SchedulingContext} context
   * @returns {string}
   */
  explain(placement, state, context) {
    const { teacherId } = placement;
    const teacherName = context.teacher(teacherId ?? '')?.name ?? 'That teacher';

    for (const slot of placement.slots) {
      if (state.isTeacherFree(teacherId ?? '', slot.id)) continue;

      // Find who they are already with, so the message is actionable.
      for (const schoolClass of context.schoolData.classes) {
        const lesson = state.lessonAt(schoolClass.id, slot.id);
        if (lesson?.teacherId === teacherId) {
          return `${teacherName} is already teaching ${schoolClass.name} on ${slot.dayLabel} period ${slot.periodNumber}.`;
        }
      }
      return `${teacherName} is already busy on ${slot.dayLabel} period ${slot.periodNumber}.`;
    }
    return `${teacherName} has a clash in one of those periods.`;
  }
}
