// =============================================================================
// Frontend fetcher for calculateAttendanceRate() (packages/types/src/attendance-rate.ts)
// =============================================================================
// Combines the page's own RLS-scoped attendance_records read with the new
// GET /students/:id/approved-absences endpoint for the overlay — the one
// piece a student or non-submitting-guardian page cannot fetch itself via
// direct Supabase access, since absence_requests' own RLS grants neither
// role a SELECT path (see docs/audits/shared-helpers-call-sites.md §1.3).
// =============================================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import type { AttendanceRateInput } from '@school-manager/types';
import { serverApiFetch } from '@/lib/api/server';

interface ApprovedAbsencesResponse {
  approved_absences: Array<{
    id: string;
    absence_date: string;
    approved_at: string | null;
    approved_by_role: 'ADMIN' | 'TEACHER' | null;
    submitted_by_current_user: boolean;
    reason?: string;
  }>;
}

export async function fetchAttendanceData(
  client: SupabaseClient,
  studentId: string,
  range: { startDate: string; endDate: string },
): Promise<AttendanceRateInput> {
  const [{ data: records }, overlay] = await Promise.all([
    client
      .from('attendance_records')
      .select('student_id, date, status')
      .eq('student_id', studentId)
      .gte('date', range.startDate)
      .lte('date', range.endDate),
    serverApiFetch<ApprovedAbsencesResponse>(
      `/students/${studentId}/approved-absences?startDate=${range.startDate}&endDate=${range.endDate}`,
    ),
  ]);

  return {
    records: (records ?? []).map((r) => ({ student_id: r.student_id as string, date: r.date as string, status: r.status as string })),
    approvedAbsences: overlay.approved_absences.map((a) => ({ student_id: studentId, absence_date: a.absence_date })),
  };
}
