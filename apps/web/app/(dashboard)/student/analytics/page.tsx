import { createClient } from '@/lib/supabase/server';
import BackButton from '@/components/BackButton';
import { fetchAttendanceData } from '@/lib/attendance/fetchAttendanceData';
import { calculateAttendanceRate } from '@school-manager/types';

function Bar({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 bg-slate-100 rounded-full h-2 overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      <span className="text-xs font-semibold text-slate-600 w-10 text-right">{pct.toFixed(1)}%</span>
    </div>
  );
}

export default async function StudentAnalyticsPage({ searchParams }: { searchParams: { termId?: string } }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: userRow } = await supabase.from('users').select('id').eq('auth_id', user.id).maybeSingle();
  const { data: student } = await supabase
    .from('students').select('id, current_class_id').eq('user_id', userRow?.id ?? '').maybeSingle();

  const { data: terms } = await supabase.from('terms').select('id, name, start_date, end_date, is_current').order('start_date', { ascending: false });
  const termId = searchParams.termId ?? (terms ?? []).find((t) => t.is_current)?.id ?? (terms ?? [])[0]?.id;
  const termRow = (terms ?? []).find((t) => t.id === termId);

  // Grades
  const { data: assessments } = student && termId
    ? await supabase.from('assessments')
        .select('id, name, max_marks, subject:subjects(id, name)')
        .eq('class_id', student.current_class_id ?? '').eq('term_id', termId)
    : { data: [] };

  const assessmentIds = (assessments ?? []).map((a) => a.id);
  const { data: grades } = assessmentIds.length
    ? await supabase.from('grades').select('assessment_id, score').eq('student_id', student!.id).in('assessment_id', assessmentIds)
    : { data: [] };
  const gradeMap = Object.fromEntries((grades ?? []).map((g) => [g.assessment_id, g.score]));

  // Class averages for comparison — via a safe aggregate RPC (RLS blocks
  // students from reading classmates' raw grade rows; this returns only the
  // averaged score per assessment, never per-student data).
  const { data: classAverages } = assessmentIds.length
    ? await supabase.rpc('class_average_scores', { p_assessment_ids: assessmentIds })
    : { data: [] };
  const classAvgMap: Record<string, number> = {};
  for (const row of classAverages ?? []) {
    if (row.avg_score != null) classAvgMap[row.assessment_id] = Number(row.avg_score);
  }

  // Subject summaries
  type SubSummary = { name: string; myAvg: number | null; classAvg: number | null };
  const bySubject: Record<string, SubSummary> = {};
  for (const a of assessments ?? []) {
    const sub = a.subject as unknown as { id: string; name: string } | null;
    if (!sub) continue;
    if (!bySubject[sub.id]) bySubject[sub.id] = { name: sub.name, myAvg: null, classAvg: null };
    const row = bySubject[sub.id]!;
    const subAssessments = (assessments ?? []).filter((x) => (x.subject as any)?.id === sub.id);
    const scored = subAssessments.filter((x) => gradeMap[x.id] != null);
    if (scored.length) {
      const pctSum = scored.reduce((s, x) => s + (gradeMap[x.id]! / x.max_marks) * 100, 0);
      row.myAvg = pctSum / scored.length;
    }
    const classSc = subAssessments.filter((x) => classAvgMap[x.id] != null);
    if (classSc.length) {
      const pctSum = classSc.reduce((s, x) => s + (classAvgMap[x.id]! / x.max_marks) * 100, 0);
      row.classAvg = pctSum / classSc.length;
    }
  }

  // Attendance — student has no RLS path to absence_requests directly (see
  // docs/audits/shared-helpers-call-sites.md §1.3), so the approved-absence
  // overlay comes from the approved-absences endpoint via fetchAttendanceData.
  const attendanceInput = student && termRow
    ? await fetchAttendanceData(supabase, student.id, { startDate: termRow.start_date, endDate: termRow.end_date })
    : { records: [], approvedAbsences: [] };

  // Present/Late/Absent cards stay raw record-status counts (informational,
  // unaffected by the overlay) — only the headline rate below applies it.
  const attPresent = attendanceInput.records.filter((r) => r.status === 'PRESENT').length;
  const attLate = attendanceInput.records.filter((r) => r.status === 'LATE').length;
  const attAbsent = attendanceInput.records.filter((r) => r.status === 'ABSENT').length;
  const attOverall = calculateAttendanceRate(attendanceInput);
  const attRate = attOverall.total_school_days > 0 ? attOverall.attendance_rate : null;

  // Attendance by week (group by ISO week), overlay-aware via calculateAttendanceRate per bucket.
  function weekStartOf(date: string): string {
    const d = new Date(`${date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - d.getUTCDay());
    return d.toISOString().slice(0, 10);
  }
  const weekBuckets = new Map<string, { records: typeof attendanceInput.records; approvedAbsences: typeof attendanceInput.approvedAbsences }>();
  for (const r of attendanceInput.records) {
    const wk = weekStartOf(r.date);
    if (!weekBuckets.has(wk)) weekBuckets.set(wk, { records: [], approvedAbsences: [] });
    weekBuckets.get(wk)!.records.push(r);
  }
  for (const a of attendanceInput.approvedAbsences) {
    const wk = weekStartOf(a.absence_date);
    if (!weekBuckets.has(wk)) weekBuckets.set(wk, { records: [], approvedAbsences: [] });
    weekBuckets.get(wk)!.approvedAbsences.push(a);
  }
  const weeks = Array.from(weekBuckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-8)
    .map(([weekKey, bucket]) => {
      const result = calculateAttendanceRate(bucket);
      return [weekKey, { present: result.present_days, total: result.total_school_days }] as const;
    });

  // Assignment submission rate
  const { data: classAssignments } = student
    ? await supabase.from('assignments').select('id').eq('class_id', student.current_class_id ?? '').lte('due_date', new Date().toISOString())
    : { data: [] };
  const assignmentIds = (classAssignments ?? []).map((a) => a.id);
  const { data: mySubs } = assignmentIds.length
    ? await supabase.from('submissions').select('id').eq('student_id', student!.id).in('assignment_id', assignmentIds)
    : { data: [] };
  const subRate = assignmentIds.length ? ((mySubs ?? []).length / assignmentIds.length) * 100 : null;

  const subjectRows = Object.values(bySubject);
  const selectedTermName = (terms ?? []).find((t) => t.id === termId)?.name ?? 'this term';

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-4">
        <BackButton href="/student" />
        <div>
          <h1 className="text-2xl font-semibold">My analytics</h1>
          <p className="text-sm text-slate-500 mt-0.5">Performance overview for {selectedTermName}.</p>
        </div>
      </div>

      {/* Term selector */}
      {(terms ?? []).length > 1 && (
        <div className="flex gap-2 flex-wrap">
          {(terms ?? []).map((t) => (
            <a key={t.id} href={`/student/analytics?termId=${t.id}`}
              className={`text-sm rounded-full px-3 py-1 font-medium transition-colors ${t.id === termId ? 'bg-violet-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
              {t.name}
            </a>
          ))}
        </div>
      )}

      {/* Subject performance */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <h2 className="font-semibold text-slate-800">Subject performance</h2>
        {subjectRows.length === 0 ? (
          <p className="text-sm text-slate-400">No grades recorded yet.</p>
        ) : (
          <div className="space-y-4">
            {subjectRows.sort((a, b) => (b.myAvg ?? 0) - (a.myAvg ?? 0)).map((s) => (
              <div key={s.name}>
                <div className="flex items-baseline justify-between mb-1">
                  <span className="text-sm font-medium text-slate-700">{s.name}</span>
                  <span className={`text-xs font-semibold ${
                    s.myAvg == null ? 'text-slate-400' :
                    s.myAvg >= 70 ? 'text-emerald-600' : s.myAvg >= 50 ? 'text-amber-600' : 'text-rose-600'
                  }`}>
                    {s.myAvg != null ? `${s.myAvg.toFixed(1)}%` : '—'}
                    {s.classAvg != null && s.myAvg != null && (
                      <span className="text-slate-400 font-normal ml-1">
                        ({s.myAvg > s.classAvg ? '+' : ''}{(s.myAvg - s.classAvg).toFixed(1)} vs class avg)
                      </span>
                    )}
                  </span>
                </div>
                {s.myAvg != null && (
                  <Bar pct={s.myAvg} color={s.myAvg >= 70 ? 'bg-emerald-500' : s.myAvg >= 50 ? 'bg-amber-400' : 'bg-rose-500'} />
                )}
                {s.classAvg != null && (
                  <div className="flex items-center gap-2 mt-1">
                    <div className="flex-1 bg-slate-100 rounded-full h-1 overflow-hidden">
                      <div className="h-full rounded-full bg-slate-300" style={{ width: `${Math.min(s.classAvg, 100)}%` }} />
                    </div>
                    <span className="text-[10px] text-slate-400 w-16 text-right">Class: {s.classAvg.toFixed(1)}%</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Attendance */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-slate-800">Attendance</h2>
          {attRate != null && (
            <span className={`text-sm font-bold ${attRate >= 80 ? 'text-emerald-600' : attRate >= 60 ? 'text-amber-600' : 'text-rose-600'}`}>
              {attRate.toFixed(1)}% overall
            </span>
          )}
        </div>
        <div className="grid grid-cols-3 gap-3 text-center">
          <div className="bg-emerald-50 rounded-lg py-3">
            <p className="text-xl font-bold text-emerald-600">{attPresent}</p>
            <p className="text-xs text-slate-400">Present</p>
          </div>
          <div className="bg-amber-50 rounded-lg py-3">
            <p className="text-xl font-bold text-amber-600">{attLate}</p>
            <p className="text-xs text-slate-400">Late</p>
          </div>
          <div className="bg-rose-50 rounded-lg py-3">
            <p className="text-xl font-bold text-rose-600">{attAbsent}</p>
            <p className="text-xs text-slate-400">Absent</p>
          </div>
        </div>
        {weeks.length > 0 && (
          <div>
            <p className="text-xs text-slate-400 mb-2">Weekly attendance (last {weeks.length} weeks)</p>
            <div className="flex items-end gap-1 h-16">
              {weeks.map(([week, data]) => {
                const pct = data.total ? (data.present / data.total) * 100 : 0;
                return (
                  <div key={week} className="flex-1 flex flex-col items-center gap-0.5" title={`Week of ${week}: ${pct.toFixed(0)}%`}>
                    <div className="w-full rounded-t-sm" style={{
                      height: `${Math.max(pct, 4)}%`,
                      background: pct >= 80 ? '#22c55e' : pct >= 60 ? '#f59e0b' : '#ef4444',
                    }} />
                    <span className="text-[8px] text-slate-400">{new Date(week).toLocaleDateString('en-KE', { day: 'numeric', month: 'short' })}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Submission rate */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
        <h2 className="font-semibold text-slate-800">Assignment submission rate</h2>
        {subRate == null ? (
          <p className="text-sm text-slate-400">No assignments due yet.</p>
        ) : (
          <>
            <Bar pct={subRate} color={subRate >= 80 ? 'bg-emerald-500' : subRate >= 50 ? 'bg-amber-400' : 'bg-rose-500'} />
            <p className="text-xs text-slate-400">
              {(mySubs ?? []).length} of {assignmentIds.length} assignment{assignmentIds.length !== 1 ? 's' : ''} submitted
            </p>
          </>
        )}
      </div>
    </div>
  );
}
