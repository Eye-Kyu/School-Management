import { createClient } from '@/lib/supabase/server';
import BackButton from '@/components/BackButton';

export default async function StudentGradesPage({
  searchParams,
}: {
  searchParams: { termId?: string };
}) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: userRow } = await supabase
    .from('users')
    .select('id')
    .eq('auth_id', user.id)
    .maybeSingle();

  const { data: student } = await supabase
    .from('students')
    .select('id, current_class_id')
    .eq('user_id', userRow?.id ?? '')
    .maybeSingle();

  const { data: terms } = await supabase
    .from('terms')
    .select('id, name, is_current')
    .order('start_date', { ascending: false });

  const currentTermId = searchParams.termId
    ?? (terms ?? []).find((t) => t.is_current)?.id
    ?? (terms ?? [])[0]?.id;

  // Load grades via assessments
  let gradeRows: any[] = [];
  if (student && currentTermId) {
    const { data: assessments } = await supabase
      .from('assessments')
      .select('id, name, kind, max_score, weight, date, subject:subjects(id, name)')
      .eq('class_id', student.current_class_id ?? '')
      .eq('term_id', currentTermId);

    const assessmentIds = (assessments ?? []).map((a) => a.id);
    if (assessmentIds.length > 0) {
      const { data: grades } = await supabase
        .from('grades')
        .select('assessment_id, score, comment')
        .eq('student_id', student.id)
        .in('assessment_id', assessmentIds);

      const gradeMap = Object.fromEntries(
        (grades ?? []).map((g) => [g.assessment_id, g]),
      );
      gradeRows = (assessments ?? []).map((a) => ({
        ...a,
        grade: gradeMap[a.id] ?? null,
      }));
    }
  }

  // Group by subject
  type SubjectGroup = { name: string; rows: any[] };
  const bySubject: Record<string, SubjectGroup> = {};
  for (const row of gradeRows) {
    const sub = row.subject as { id: string; name: string } | null;
    if (!sub) continue;
    (bySubject[sub.id] ??= { name: sub.name, rows: [] }).rows.push(row);
  }

  function weightedAvg(rows: any[]) {
    const scored = rows.filter((r) => r.grade?.score != null);
    if (!scored.length) return null;
    const ws = scored.reduce((s: number, r: any) => s + (r.grade.score / r.max_score) * r.weight, 0);
    const wt = scored.reduce((s: number, r: any) => s + r.weight, 0);
    return wt > 0 ? ((ws / wt) * 100).toFixed(1) : null;
  }

  const selectedTermName = (terms ?? []).find((t) => t.id === currentTermId)?.name ?? 'this term';

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <BackButton href="/student" />
        <div>
          <h1 className="text-2xl font-semibold">My grades</h1>
          <p className="text-sm text-slate-500 mt-0.5">Assessment results for {selectedTermName}.</p>
        </div>
      </div>

      {/* Term selector + report card link */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {student && currentTermId && (
          <a href={`/print/report-card/${student.id}?termId=${currentTermId}`} target="_blank" rel="noopener noreferrer"
            className="text-sm font-medium text-violet-700 border border-violet-300 bg-violet-50 hover:bg-violet-100 rounded-lg px-4 py-1.5 transition-colors">
            🖨 Print report card
          </a>
        )}
      </div>

      {/* Term selector */}
      {(terms ?? []).length > 1 && (
        <div className="flex gap-2 flex-wrap">
          {(terms ?? []).map((t) => (
            <a key={t.id} href={`/student/grades?termId=${t.id}`}
              className={`text-sm rounded-full px-3 py-1 font-medium transition-colors ${
                t.id === currentTermId ? 'bg-violet-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}>
              {t.name}
            </a>
          ))}
        </div>
      )}

      {gradeRows.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl px-5 py-12 text-center text-sm text-slate-400">
          No grades recorded for {selectedTermName} yet.
        </div>
      ) : (
        <div className="space-y-5">
          {Object.entries(bySubject).map(([, group]) => {
            const avg = weightedAvg(group.rows);
            return (
              <div key={group.name} className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
                  <h2 className="font-semibold text-slate-800">{group.name}</h2>
                  {avg && (
                    <span className={`text-sm font-semibold px-2.5 py-0.5 rounded-full ${
                      parseFloat(avg) >= 70 ? 'bg-emerald-100 text-emerald-700'
                      : parseFloat(avg) >= 50 ? 'bg-amber-100 text-amber-700'
                      : 'bg-rose-100 text-rose-600'
                    }`}>
                      {avg}%
                    </span>
                  )}
                </div>
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
                    <tr>
                      <th className="px-5 py-2 text-left font-medium">Assessment</th>
                      <th className="px-4 py-2 text-center font-medium">Type</th>
                      <th className="px-4 py-2 text-center font-medium">Score</th>
                      <th className="px-4 py-2 text-center font-medium">%</th>
                      <th className="px-5 py-2 text-left font-medium hidden sm:table-cell">Comment</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.rows.map((row) => {
                      const score = row.grade?.score;
                      const pct = typeof score === 'number' ? ((score / row.max_score) * 100).toFixed(1) : null;
                      const color = pct === null ? 'text-slate-400'
                        : parseFloat(pct) >= 70 ? 'text-emerald-700 font-semibold'
                        : parseFloat(pct) >= 50 ? 'text-amber-600 font-semibold'
                        : 'text-rose-600 font-semibold';
                      return (
                        <tr key={row.id} className="border-t border-slate-100">
                          <td className="px-5 py-2.5 text-slate-800">{row.name}</td>
                          <td className="px-4 py-2.5 text-center text-slate-500 text-xs">{row.kind}</td>
                          <td className="px-4 py-2.5 text-center">
                            {typeof score === 'number' ? `${score} / ${row.max_score}` : '—'}
                          </td>
                          <td className={`px-4 py-2.5 text-center ${color}`}>{pct ? `${pct}%` : '—'}</td>
                          <td className="px-5 py-2.5 text-slate-400 text-xs hidden sm:table-cell">
                            {row.grade?.comment ?? ''}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
