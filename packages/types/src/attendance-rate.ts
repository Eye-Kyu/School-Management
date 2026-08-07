// =============================================================================
// Shared attendance rate calculation
// =============================================================================
// Single source of truth for "what is this student's/class's attendance
// rate," replacing 9 independent ad-hoc implementations (see
// docs/audits/shared-helpers-call-sites.md §1.1) that had already converged
// on PRESENT+LATE-as-present but never applied the approved-absence overlay.
//
// The one non-obvious rule here: an approved absence normally has NO
// attendance_records row at all (see docs/audits/student-360-data-sources.md
// §1.2 and the shared-helpers audit §1.3 — approval is a read-time overlay,
// nothing is ever written for that date). A version of this function that
// only iterated `records` and checked each one's status against the overlay
// would silently miss every day that has *only* an overlay entry and no
// row — undercounting total_school_days and approved_absences in exactly
// the scenario this helper exists to fix. So the working date set is the
// union of every record's date and every overlay entry's date, not just
// `records`.
// =============================================================================

// Deliberately its own (widened) type, not a re-export of the Zod-inferred
// `AttendanceStatus` from schemas/attendance.ts — this function must
// tolerate an unrecognized value defensively (see the switch below) rather
// than assume the DB enum is exhaustive.
export type AttendanceRateStatus = 'PRESENT' | 'LATE' | 'ABSENT' | 'EXCUSED' | string;

export interface AttendanceRecord {
  student_id: string;
  date: string; // ISO YYYY-MM-DD
  status: AttendanceRateStatus;
}

export interface ApprovedAbsenceOverlay {
  student_id: string;
  absence_date: string; // ISO YYYY-MM-DD
}

export interface AttendanceRateInput {
  records: AttendanceRecord[];
  approvedAbsences: ApprovedAbsenceOverlay[];
}

export interface AttendanceRateResult {
  attendance_rate: number; // 0-100, LATE counted as present
  present_days: number; // includes LATE
  tardy_count: number; // LATE only
  approved_absences: number;
  unapproved_absences: number;
  total_school_days: number;
}

export function calculateAttendanceRate(input: AttendanceRateInput): AttendanceRateResult {
  const zero: AttendanceRateResult = {
    attendance_rate: 0,
    present_days: 0,
    tardy_count: 0,
    approved_absences: 0,
    unapproved_absences: 0,
    total_school_days: 0,
  };

  // Dedup approved-absence overlay entries by date before matching — an
  // overlapping/duplicate submission for the same date must only ever count
  // as one school day.
  const approvedDates = new Set(input.approvedAbsences.map((a) => a.absence_date));

  // One record per date is assumed (attendance_records has a real
  // UNIQUE(student_id, date) constraint) — if duplicates are ever passed in,
  // the later one in the array wins, matching a plain object-map merge.
  const recordByDate = new Map<string, AttendanceRateStatus>();
  for (const r of input.records) recordByDate.set(r.date, r.status);

  const allDates = new Set<string>([...recordByDate.keys(), ...approvedDates]);
  if (allDates.size === 0) return zero;

  let presentDays = 0;
  let tardyCount = 0;
  let approvedAbsences = 0;
  let unapprovedAbsences = 0;

  for (const date of allDates) {
    const status = recordByDate.get(date);

    // No record at all for this date, but an overlay entry exists — the
    // normal shape of an approved absence (see header comment). Counts as
    // an approved absence directly; there's no status to consult.
    if (status === undefined) {
      approvedAbsences++;
      continue;
    }

    if (status === 'PRESENT') {
      presentDays++;
      continue;
    }
    if (status === 'LATE') {
      presentDays++;
      tardyCount++;
      continue;
    }
    if (status === 'EXCUSED') {
      // A literal EXCUSED row (rare — normally this status only ever exists
      // as the read-time overlay result, never a written row, per the
      // audits above) already says excused on its own; no overlay match
      // needed. Approval for a day the student was actually PRESENT is
      // handled above (PRESENT wins outright, the overlay is never
      // consulted for it) — this branch is unreachable for that case.
      approvedAbsences++;
      continue;
    }
    if (status === 'ABSENT') {
      if (approvedDates.has(date)) approvedAbsences++;
      else unapprovedAbsences++;
      continue;
    }

    // Unknown/non-standard status — defensive, shouldn't happen given the
    // AttendanceStatus DB enum, but don't throw on it.
    // eslint-disable-next-line no-console
    console.warn(`calculateAttendanceRate: unrecognized attendance status "${status}" on ${date}, treating as unapproved absence`);
    if (approvedDates.has(date)) approvedAbsences++;
    else unapprovedAbsences++;
  }

  const totalSchoolDays = allDates.size;
  const attendanceRate = totalSchoolDays > 0 ? (presentDays / totalSchoolDays) * 100 : 0;

  return {
    attendance_rate: attendanceRate,
    present_days: presentDays,
    tardy_count: tardyCount,
    approved_absences: approvedAbsences,
    unapproved_absences: unapprovedAbsences,
    total_school_days: totalSchoolDays,
  };
}
