import { redirect, notFound } from 'next/navigation';
import { Badge } from '@school-manager/ui';
import { serverApiFetch } from '@/lib/api/server';
import { ApiError } from '@/lib/api';
import { timeAgo } from '@/lib/utils/timeAgo';

// =============================================================================
// Student 360 — read-only pastoral-care aggregation (Bucket 1, PR 4a)
// =============================================================================
// ADMIN + the student's own Class Teacher only. Clinical/neutral tone,
// deliberately not this app's usual gradient-card style — color is used
// only for the red/gray/green meaning scale below, never for decoration.
// =============================================================================

interface Student360View {
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
    by_subject: Array<{ subject_id: string; subject_name: string; average_percentage: number; assessment_count: number }>;
    struggling_subjects: Array<{ subject_id: string; subject_name: string; average_percentage: number }>;
    recent_grades: Array<{ assessment_name: string; subject_name: string; score: number; max_marks: number; percentage: number; graded_at: string }>;
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
  metadata: { aggregated_at: string; viewer_id: string; viewer_role: string };
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
      <h2 className="font-semibold text-slate-800">{title}</h2>
      {children}
    </div>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default async function Student360Page({ params }: { params: { studentId: string } }) {
  let data: Student360View;
  try {
    data = await serverApiFetch<Student360View>(`/students/${params.studentId}/student-360`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 403) {
      redirect('/dashboard?denied=student-360');
    }
    if (err instanceof ApiError && err.status === 404) {
      notFound();
    }
    throw err;
  }

  const { student, academic, attendance, behavior, incident_reports } = data;
  const bestSubject = academic.by_subject.length > 0
    ? academic.by_subject.reduce((best, s) => (s.average_percentage > best.average_percentage ? s : best))
    : null;

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Header */}
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <div className="flex items-start justify-between flex-wrap gap-2">
          <div>
            <h1 className="text-xl font-semibold text-slate-800">{student.full_name}</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              {student.class_name} · Admission No. {student.admission_no} · {student.current_term.name}
            </p>
          </div>
          <p className="text-xs text-slate-400">Last updated: {timeAgo(data.metadata.aggregated_at)}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Academic */}
        <Section title="Academic">
          {academic.assessment_count === 0 ? (
            <p className="text-sm text-slate-400">No assessments graded yet this term.</p>
          ) : (
            <>
              <div className="flex items-baseline gap-3">
                <span className="text-4xl font-bold text-slate-800">
                  {academic.overall_average_percentage != null ? `${Math.round(academic.overall_average_percentage)}%` : '—'}
                </span>
                <span className="text-sm text-slate-500">{academic.assessment_count} assessment{academic.assessment_count === 1 ? '' : 's'}</span>
              </div>
              {(academic.struggling_subjects.length > 0 || bestSubject) && (
                <div className="flex flex-wrap gap-2">
                  {academic.struggling_subjects.map((s) => (
                    <span key={s.subject_id} className="text-xs font-medium px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200">
                      {s.subject_name}: {Math.round(s.average_percentage)}%
                    </span>
                  ))}
                  {bestSubject && (
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                      {bestSubject.subject_name}: {Math.round(bestSubject.average_percentage)}%
                    </span>
                  )}
                </div>
              )}
              <div className="space-y-1.5">
                {academic.recent_grades.map((g, i) => (
                  <div key={i} className="flex items-center justify-between text-sm border-t border-slate-100 pt-1.5 first:border-t-0 first:pt-0">
                    <span className="text-slate-600 truncate mr-2">{g.assessment_name} <span className="text-slate-400">· {g.subject_name}</span></span>
                    <span className="text-slate-700 font-medium shrink-0">{g.score}/{g.max_marks} ({Math.round(g.percentage)}%)</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </Section>

        {/* Attendance */}
        <Section title="Attendance">
          {attendance.total_school_days === 0 ? (
            <p className="text-sm text-slate-400">No attendance recorded yet this term.</p>
          ) : (
            <>
              <span className={`text-4xl font-bold ${attendance.unapproved_absences > 0 ? 'text-rose-700' : 'text-slate-800'}`}>
                {Math.round(attendance.attendance_rate)}%
              </span>
              <p className="text-sm text-slate-500">
                Tardies: {attendance.tardy_count} · Approved absences: {attendance.approved_absences} · Unapproved: {attendance.unapproved_absences}
              </p>
              {attendance.unapproved_absences === 0 && attendance.approved_absences === 0 ? (
                <p className="text-sm text-emerald-700">Perfect attendance this term.</p>
              ) : (
                <div className="space-y-1.5">
                  {attendance.recent_absences.map((a) => (
                    <div key={a.date} className="flex items-center justify-between text-sm border-t border-slate-100 pt-1.5 first:border-t-0 first:pt-0">
                      <span className="text-slate-600">{formatDate(a.date)}</span>
                      <Badge variant={a.approved ? 'secondary' : 'destructive'}>{a.approved ? 'Approved' : 'Unapproved'}</Badge>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </Section>

        {/* Behavior */}
        <Section title="Behavior">
          {behavior.positive_incidents_count === 0 && behavior.negative_incidents_count === 0 ? (
            <p className="text-sm text-slate-400">No behavior incidents this term.</p>
          ) : (
            <>
              <span className={`text-4xl font-bold ${
                behavior.points_balance > 0 ? 'text-emerald-700' : behavior.points_balance < 0 ? 'text-rose-700' : 'text-slate-600'
              }`}>
                {behavior.points_balance > 0 ? '+' : ''}{behavior.points_balance}
              </span>
              <p className="text-sm text-slate-500">
                {behavior.positive_incidents_count} positive · {behavior.negative_incidents_count} negative · {behavior.incidents_this_term_count} this term
              </p>
              <div className="space-y-1.5">
                {behavior.recent_incidents.map((inc, i) => (
                  <div key={i} className="text-sm border-t border-slate-100 pt-1.5 first:border-t-0 first:pt-0">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-600">{formatDate(inc.date)} · {inc.category}</span>
                      <span className={`font-medium ${inc.points_delta > 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                        {inc.points_delta > 0 ? '+' : ''}{inc.points_delta}
                      </span>
                    </div>
                    <p className="text-slate-500 text-xs mt-0.5">{inc.description}</p>
                  </div>
                ))}
              </div>
            </>
          )}
        </Section>

        {/* Incident reports */}
        <Section title="Incident reports">
          {incident_reports.total_count === 0 ? (
            <p className="text-sm text-slate-400">No incidents reported.</p>
          ) : (
            <>
              <div className="flex items-baseline gap-3">
                <span className="text-4xl font-bold text-slate-800">{incident_reports.total_count}</span>
                {incident_reports.last_incident_date && (
                  <span className="text-sm text-slate-500">Last incident: {timeAgo(incident_reports.last_incident_date)}</span>
                )}
              </div>
              <p className="text-sm text-slate-500">
                {Object.entries(incident_reports.count_by_category).map(([cat, count]) => `${cat}: ${count}`).join(', ')}
              </p>
              <div className="space-y-2">
                {incident_reports.recent_reports.map((r, i) => (
                  <div key={i} className="text-sm border-t border-slate-100 pt-1.5 first:border-t-0 first:pt-0">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-700 font-medium">{r.category}</span>
                      <span className="text-slate-400 text-xs">{formatDate(r.date)}</span>
                    </div>
                    <p className="text-slate-500 text-xs mt-0.5">Reported by {r.reporter_name} — {r.brief_summary}</p>
                  </div>
                ))}
              </div>
            </>
          )}
        </Section>
      </div>
    </div>
  );
}
