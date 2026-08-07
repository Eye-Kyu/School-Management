/**
 * Shared attendance-rate calculation (packages/types/src/attendance-rate.ts)
 * — replaces 9 independent ad-hoc PRESENT+LATE implementations, none of
 * which applied the approved-absence overlay (see
 * docs/audits/shared-helpers-call-sites.md §1.1/§1.3). The load-bearing
 * case here is a date with *only* an overlay entry and no
 * attendance_records row at all — the normal shape of an approved absence
 * (approval is a read-time overlay; nothing is ever written for that date).
 * A version of this function that only iterated `records` would silently
 * miss that day entirely, undercounting both total_school_days and
 * approved_absences in exactly the scenario this helper exists to fix.
 */

import { calculateAttendanceRate } from '@school-manager/types';

const SID = 'student-1';

describe('calculateAttendanceRate', () => {
  it('returns all-zero for no input at all', () => {
    expect(calculateAttendanceRate({ records: [], approvedAbsences: [] })).toEqual({
      attendance_rate: 0,
      present_days: 0,
      tardy_count: 0,
      approved_absences: 0,
      unapproved_absences: 0,
      total_school_days: 0,
    });
  });

  it('counts PRESENT and LATE both as present, LATE also as tardy', () => {
    const result = calculateAttendanceRate({
      records: [
        { student_id: SID, date: '2026-01-05', status: 'PRESENT' },
        { student_id: SID, date: '2026-01-06', status: 'LATE' },
      ],
      approvedAbsences: [],
    });
    expect(result.present_days).toBe(2);
    expect(result.tardy_count).toBe(1);
    expect(result.total_school_days).toBe(2);
    expect(result.attendance_rate).toBe(100);
  });

  it('an ABSENT day with a matching overlay entry counts as approved, not unapproved', () => {
    const result = calculateAttendanceRate({
      records: [{ student_id: SID, date: '2026-01-05', status: 'ABSENT' }],
      approvedAbsences: [{ student_id: SID, absence_date: '2026-01-05' }],
    });
    expect(result.approved_absences).toBe(1);
    expect(result.unapproved_absences).toBe(0);
    expect(result.total_school_days).toBe(1);
  });

  it('an ABSENT day with NO matching overlay entry counts as unapproved', () => {
    const result = calculateAttendanceRate({
      records: [{ student_id: SID, date: '2026-01-05', status: 'ABSENT' }],
      approvedAbsences: [],
    });
    expect(result.approved_absences).toBe(0);
    expect(result.unapproved_absences).toBe(1);
  });

  // The load-bearing case (Correction #1 from the Foundation PR plan):
  // approved absences normally have NO attendance_records row at all.
  it('a date with ONLY an overlay entry (no attendance_records row) counts as an approved absence, not a missing day', () => {
    const result = calculateAttendanceRate({
      records: [],
      approvedAbsences: [{ student_id: SID, absence_date: '2026-01-05' }],
    });
    expect(result.total_school_days).toBe(1);
    expect(result.approved_absences).toBe(1);
    expect(result.present_days).toBe(0);
    expect(result.unapproved_absences).toBe(0);
    expect(result.attendance_rate).toBe(0); // not present that day
  });

  it('mixes overlay-only days with real records correctly in the same window', () => {
    const result = calculateAttendanceRate({
      records: [
        { student_id: SID, date: '2026-01-05', status: 'PRESENT' },
        { student_id: SID, date: '2026-01-06', status: 'ABSENT' }, // unapproved
      ],
      approvedAbsences: [
        { student_id: SID, absence_date: '2026-01-07' }, // no record for this date at all
      ],
    });
    expect(result.total_school_days).toBe(3);
    expect(result.present_days).toBe(1);
    expect(result.unapproved_absences).toBe(1);
    expect(result.approved_absences).toBe(1);
    expect(result.attendance_rate).toBeCloseTo(100 / 3, 5);
  });

  it('approval for a day the student was actually PRESENT is ignored — PRESENT always wins', () => {
    const result = calculateAttendanceRate({
      records: [{ student_id: SID, date: '2026-01-05', status: 'PRESENT' }],
      approvedAbsences: [{ student_id: SID, absence_date: '2026-01-05' }],
    });
    expect(result.present_days).toBe(1);
    expect(result.approved_absences).toBe(0);
    expect(result.total_school_days).toBe(1);
  });

  it('a literal EXCUSED status row counts as an approved absence directly, without needing an overlay match', () => {
    const result = calculateAttendanceRate({
      records: [{ student_id: SID, date: '2026-01-05', status: 'EXCUSED' }],
      approvedAbsences: [],
    });
    expect(result.approved_absences).toBe(1);
    expect(result.unapproved_absences).toBe(0);
  });

  it('dedups duplicate overlay entries for the same date into a single school day', () => {
    const result = calculateAttendanceRate({
      records: [],
      approvedAbsences: [
        { student_id: SID, absence_date: '2026-01-05' },
        { student_id: SID, absence_date: '2026-01-05' },
      ],
    });
    expect(result.total_school_days).toBe(1);
    expect(result.approved_absences).toBe(1);
  });

  it('treats an unrecognized status defensively as an unapproved absence unless overlay-matched', () => {
    const result = calculateAttendanceRate({
      records: [{ student_id: SID, date: '2026-01-05', status: 'SOME_FUTURE_STATUS' }],
      approvedAbsences: [],
    });
    expect(result.unapproved_absences).toBe(1);
    expect(result.present_days).toBe(0);
  });

  it('attendance_rate is present_days / total_school_days (overlay-only days included in the denominator, not the numerator)', () => {
    const result = calculateAttendanceRate({
      records: [
        { student_id: SID, date: '2026-01-01', status: 'PRESENT' },
        { student_id: SID, date: '2026-01-02', status: 'PRESENT' },
        { student_id: SID, date: '2026-01-03', status: 'PRESENT' },
      ],
      approvedAbsences: [{ student_id: SID, absence_date: '2026-01-04' }],
    });
    expect(result.total_school_days).toBe(4);
    expect(result.present_days).toBe(3);
    expect(result.attendance_rate).toBe(75);
  });
});
