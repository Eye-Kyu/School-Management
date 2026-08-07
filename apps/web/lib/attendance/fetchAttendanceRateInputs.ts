// =============================================================================
// Bulk (multi-student) fetcher for calculateAttendanceRate()
// =============================================================================
// For ADMIN/whole-school and TEACHER/whole-class analytics pages only —
// both roles already have direct RLS-scoped SELECT on absence_requests
// (current_user_role() = 'ADMIN', or the class/subject-teacher EXISTS
// clauses in absence_requests_select), so unlike the single-student
// fetchAttendanceData.ts (student/parent-facing, which needs the
// approved-absences endpoint), this queries both tables with the page's
// own RLS-scoped client — no service-role access needed or used.
// =============================================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import type { AttendanceRateInput } from '@school-manager/types';

export async function fetchAttendanceRateInputs(
  client: SupabaseClient,
  params: { studentIds: string[]; startDate: string; endDate: string },
): Promise<AttendanceRateInput> {
  if (params.studentIds.length === 0) {
    return { records: [], approvedAbsences: [] };
  }

  const [{ data: records }, { data: requests }] = await Promise.all([
    client
      .from('attendance_records')
      .select('student_id, date, status')
      .in('student_id', params.studentIds)
      .gte('date', params.startDate)
      .lte('date', params.endDate),
    client
      .from('absence_requests')
      .select('student_id, start_date, end_date')
      .in('student_id', params.studentIds)
      .eq('status', 'APPROVED')
      .lte('start_date', params.endDate)
      .gte('end_date', params.startDate),
  ]);

  // absence_requests stores date ranges; calculateAttendanceRate() expects
  // one overlay entry per day, clipped to the requested window.
  const approvedAbsences: AttendanceRateInput['approvedAbsences'] = [];
  for (const r of requests ?? []) {
    const rangeStart = r.start_date > params.startDate ? r.start_date : params.startDate;
    const rangeEnd = r.end_date < params.endDate ? r.end_date : params.endDate;
    let cursor = new Date(`${rangeStart}T00:00:00Z`);
    const endDate = new Date(`${rangeEnd}T00:00:00Z`);
    while (cursor <= endDate) {
      approvedAbsences.push({ student_id: r.student_id, absence_date: cursor.toISOString().slice(0, 10) });
      cursor = new Date(cursor.getTime() + 86_400_000);
    }
  }

  return {
    records: (records ?? []).map((r: any) => ({ student_id: r.student_id, date: r.date, status: r.status })),
    approvedAbsences,
  };
}
