// =============================================================================
// Student 360 — read-only pastoral-care aggregation view (Bucket 1, PR 4a)
// =============================================================================
// Response shape only — not Zod-validated like packages/types/src inputs,
// since this never crosses back in as a request body. Colocated with the
// service rather than packages/types/src because it has exactly one
// consumer (the Student 360 page), unlike calculateAttendanceRate/
// calculateStudentTermAverage, which are genuinely shared cross-app.
// =============================================================================

export interface Student360View {
  student: {
    id: string;
    admission_no: string;
    full_name: string;
    class_name: string;
    current_term: { id: string; name: string };
  };
  academic: {
    overall_average_percentage: number | null;
    assessment_count: number;
    by_subject: Array<{
      subject_id: string;
      subject_name: string;
      average_percentage: number;
      assessment_count: number;
    }>;
    struggling_subjects: Array<{ subject_id: string; subject_name: string; average_percentage: number }>;
    recent_grades: Array<{
      assessment_name: string;
      subject_name: string;
      score: number;
      max_marks: number;
      percentage: number;
      graded_at: string;
    }>;
  };
  attendance: {
    attendance_rate: number;
    present_days: number;
    tardy_count: number;
    approved_absences: number;
    unapproved_absences: number;
    total_school_days: number;
    recent_absences: Array<{ date: string; approved: boolean }>;
  };
  behavior: {
    points_balance: number;
    positive_incidents_count: number;
    negative_incidents_count: number;
    incidents_this_term_count: number;
    recent_incidents: Array<{ date: string; category: string; points_delta: number; description: string }>;
  };
  incident_reports: {
    total_count: number;
    count_by_category: Record<string, number>;
    last_incident_date: string | null;
    recent_reports: Array<{ date: string; category: string; reporter_name: string; brief_summary: string }>;
  };
  metadata: {
    aggregated_at: string;
    viewer_id: string;
    viewer_role: string;
  };
}

// The cached shape — everything except `metadata`, which is always
// attached fresh per request (see student-360-cache.ts / Student360Service).
export type Student360Data = Omit<Student360View, 'metadata'>;
