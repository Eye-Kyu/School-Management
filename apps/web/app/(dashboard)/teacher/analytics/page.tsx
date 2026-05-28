import { createClient } from '@/lib/supabase/server';
import BackButton from '@/components/BackButton';
import Link from 'next/link';

function Bar({ pct, color = 'bg-slate-700' }: { pct: number; color?: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 bg-slate-100 rounded-full h-2 overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      <span className="text-xs font-semibold text-slate-500 w-10 text-right">{pct.toFixed(0)}%</span>
    </div>
  );
}

export default async function TeacherAnalyticsPage({
  searchParams,
}: {
  searchParams: { classId?: string; termId?: string };
}) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: userRow } = await supabase.from('users').select('id').eq('auth_id', user.id).maybeSingle();
  const { data: teacher } = await supabase.from('teachers').select('id').eq('user_id', userRow?.id ?? '').maybeSingle();

  const [{ data: myClasses }, { data: terms }] = await Promise.all([
    supabase.from('subject_assignments').select('class_id, class:classes(id, name)').eq('teacher_id', teacher?.id ?? ''),
    supabase.from('terms').select('id, name, start_date, end_date, is_current').order('start_date', { ascending: false }),
  ]);

  const seen = new Set<string>();
  const classes = (myClasses ?? [])
    .map((a) => a.class as unknown as { id: string; name: string })
    .filter((c) => c?.id && !seen.has(c.id) && seen.add(c.id));

  const classId = searchParams.classId ?? classes[0]?.id ?? '';
  const termId = searchParams.termId ?? (terms ?? []).find((t) => t.is_current)?.id ?? (terms ?? [])[0]?.id ?? '';
  const term = (terms ?? []).find((t) => t.id === termId);

  // Students in selected class
  const { data: students } = classId
    ? await supabase.from('students')
        .select('id, user:users!user_id(full_name)')
        .eq('current_class_id', classId).eq('is_active', true)
    : { data: [] };

  // Assessments this term for this class
  const { data: assessments } = classId && termId
    ? await supabase.from('assessments')
        .select('id, name, kind, max_score, subject:subjects(name)')
        .eq('class_id', classId).eq('term_id', termId).order('name')
    : { data: [] };

  // All grades for these assessments
  const aIds = (assessments ?? []).map((a) => a.id);
  const { data: allGrades } = aIds.length
    ? await supabase.from('grades').select('assessment_id, student_id, score').in('assessment_id', aIds)
    : { data: [] };

  // Class avg per assessment
  const assessmentAvgs = (assessments ?? []).map((a) => {
    const scores = (allGrades ?? []).filter((g) => g.assessment_id === a.id && g.score != null).map((g) => g.score as number);
    const avg = scores.length ? scores.reduce((s, v) => s + v, 0) / scores.length : null;
    const pct = avg != null ? (avg / a.max_score) * 100 : null;
    return { ...a, avg, pct, count: scores.length };
  });

  // Attendance trends per week for the class
  const { data: attRecords } = classId && term
    ? await supabase.from('attendance_records')
        .select('student_id, date, status')
        .in('student_id', (students ?? []).map((s) => s.id))
        .gte('date', term.start_date).lte('date', term.end_date)
    : { data: [] };

  const weekMap: Record<string, { present: number; total: number }> = {};
  for (const r of attRecords ?? []) {
    const d = new Date(r.date);
    d.setDate(d.getDate() - d.getDay());
    const key = d.toISOString().slice(0, 10);
    if (!weekMap[key]) weekMap[key] = { present: 0, total: 0 };
    weekMap[key]!.total++;
    if (r.status === 'PRESENT' || r.status === 'LATE') weekMap[key]!.present++;
  }
  const weeks = Object.entries(weekMap).slice(-8);

  // Per-student averages for at-risk detection
  const { data: classAssignments } = classId
    ? await supabase.from('assignments').select('id').eq('class_id', classId).lte('due_date', new Date().toISOString())
    : { data: [] };
  const assignmentIds = (classAssignments ?? []).map((a) => a.id);
  const { data: allSubs } = assignmentIds.length
    ? await supabase.from('submissions').select('student_id, assignment_id').in('assignment_id', assignmentIds)
    : { data: [] };

  const attTotal = (attRecords ?? []).length;

  type StudentRisk = {
    id: string; name: string; attRate: number | null;
    gradeAvg: number | null; subRate: number | null; riskLevel: 'HIGH' | 'MEDIUM' | null;
  };

  const studentStats: StudentRisk[] = (students ?? []).map((s) => {
    const myAtt = (attRecords ?? []).filter((r) => r.student_id === s.id);
    const myPresent = myAtt.filter((r) => r.status === 'PRESENT' || r.status === 'LATE').length;
    const attRate = myAtt.length ? (myPresent / myAtt.length) * 100 : null;

    const myGrades = aIds.map((aId) => {
      const g = (allGrades ?? []).find((gr) => gr.assessment_id === aId && gr.student_id === s.id);
      const a = (assessments ?? []).find((x) => x.id === aId)!;
      return g?.score != null ? (g.score / a.max_score) * 100 : null;
    }).filter((v): v is number => v != null);
    const gradeAvg = myGrades.length ? myGrades.reduce((a, b) => a + b, 0) / myGrades.length : null;

    const mySubs = (allSubs ?? []).filter((sub) => sub.student_id === s.id).length;
    const subRate = assignmentIds.length ? (mySubs / assignmentIds.length) * 100 : null;

    const risks = [attRate != null && attRate < 70, gradeAvg != null && gradeAvg < 50, subRate != null && subRate < 40].filter(Boolean).length;
    const riskLevel = risks >= 2 ? 'HIGH' : risks === 1 ? 'MEDIUM' : null;

    return { id: s.id, name: ((s.user as any)?.full_name ?? '—'), attRate, gradeAvg, subRate, riskLevel };
  });

  const atRisk = studentStats.filter((s) => s.riskLevel !== null).sort((a, b) => (a.riskLevel === 'HIGH' ? -1 : 1));

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <BackButton href="/teacher" />
        <div>
          <h1 className="text-2xl font-semibold">Class analytics</h1>
          <p className="text-sm text-slate-500 mt-0.5">Performance insights for your classes.</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap bg-white border border-slate-200 rounded-xl p-4">
        <div>
          <p className="text-xs font-medium text-slate-400 mb-1.5">Class</p>
          <div className="flex gap-2 flex-wrap">
            {classes.map((c) => (
              <a key={c.id} href={`/teacher/analytics?classId=${c.id}&termId=${termId}`}
                className={`text-sm px-3 py-1 rounded-full font-medium ${c.id === classId ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                {c.name}
              </a>
            ))}
          </div>
        </div>
        <div>
          <p className="text-xs font-medium text-slate-400 mb-1.5">Term</p>
          <div className="flex gap-2 flex-wrap">
            {(terms ?? []).map((t) => (
              <a key={t.id} href={`/teacher/analytics?classId=${classId}&termId=${t.id}`}
                className={`text-sm px-3 py-1 rounded-full font-medium ${t.id === termId ? 'bg-violet-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                {t.name}
              </a>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Assessment averages */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <h2 className="font-semibold text-slate-800">Assessment averages</h2>
          {assessmentAvgs.length === 0 ? (
            <p className="text-sm text-slate-400">No assessments this term.</p>
          ) : (
            <div className="space-y-3">
              {assessmentAvgs.map((a) => (
                <div key={a.id}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-slate-700 truncate mr-2">{a.name} <span className="text-xs text-slate-400">({(a.subject as any)?.name})</span></span>
                    <span className="text-xs text-slate-400 shrink-0">{a.count}/{(students ?? []).length} graded</span>
                  </div>
                  {a.pct != null ? (
                    <Bar pct={a.pct} color={a.pct >= 70 ? 'bg-emerald-500' : a.pct >= 50 ? 'bg-amber-400' : 'bg-rose-500'} />
                  ) : <p className="text-xs text-slate-400">No grades yet</p>}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Weekly attendance */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <h2 className="font-semibold text-slate-800">Weekly attendance</h2>
          {weeks.length === 0 ? (
            <p className="text-sm text-slate-400">No attendance data.</p>
          ) : (
            <div className="flex items-end gap-1 h-24">
              {weeks.map(([week, data]) => {
                const pct = data.total ? (data.present / data.total) * 100 : 0;
                return (
                  <div key={week} className="flex-1 flex flex-col items-center gap-1" title={`${pct.toFixed(0)}%`}>
                    <span className="text-[9px] text-slate-500 font-medium">{pct.toFixed(0)}%</span>
                    <div className="w-full rounded-t" style={{ height: `${Math.max(pct * 0.7, 4)}%`, background: pct >= 80 ? '#22c55e' : pct >= 60 ? '#f59e0b' : '#ef4444' }} />
                    <span className="text-[8px] text-slate-400">{new Date(week).toLocaleDateString('en-KE', { day: 'numeric', month: 'short' })}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* At-risk students */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-slate-800">At-risk students</h2>
          <span className="text-xs text-slate-400">Flagged by attendance &lt;70%, grades &lt;50%, or submissions &lt;40%</span>
        </div>
        {atRisk.length === 0 ? (
          <div className="rounded-lg border border-dashed border-emerald-200 bg-emerald-50/40 p-6 text-center text-sm text-emerald-600">
            No at-risk students detected. Great work!
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Student</th>
                  <th className="px-4 py-2 text-center font-medium">Attendance</th>
                  <th className="px-4 py-2 text-center font-medium">Grade avg</th>
                  <th className="px-4 py-2 text-center font-medium">Submissions</th>
                  <th className="px-4 py-2 text-center font-medium">Risk</th>
                </tr>
              </thead>
              <tbody>
                {atRisk.map((s) => (
                  <tr key={s.id} className="border-t border-slate-100">
                    <td className="px-4 py-2.5 font-medium text-slate-800">{s.name}</td>
                    <td className={`px-4 py-2.5 text-center ${s.attRate != null && s.attRate < 70 ? 'text-rose-600 font-semibold' : 'text-slate-600'}`}>
                      {s.attRate != null ? `${s.attRate.toFixed(0)}%` : '—'}
                    </td>
                    <td className={`px-4 py-2.5 text-center ${s.gradeAvg != null && s.gradeAvg < 50 ? 'text-rose-600 font-semibold' : 'text-slate-600'}`}>
                      {s.gradeAvg != null ? `${s.gradeAvg.toFixed(0)}%` : '—'}
                    </td>
                    <td className={`px-4 py-2.5 text-center ${s.subRate != null && s.subRate < 40 ? 'text-amber-600 font-semibold' : 'text-slate-600'}`}>
                      {s.subRate != null ? `${s.subRate.toFixed(0)}%` : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${s.riskLevel === 'HIGH' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700'}`}>
                        {s.riskLevel}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
