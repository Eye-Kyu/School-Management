import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import BackButton from '@/components/BackButton';

export default async function ParentGradesPage({
  searchParams,
}: {
  searchParams: { termId?: string; studentId?: string };
}) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: userRow } = await supabase
    .from('users')
    .select('id')
    .eq('auth_id', user.id)
    .maybeSingle();

  const { data: guardianLinks } = userRow
    ? await supabase
        .from('guardians')
        .select('student:students!inner(id, admission_no, user:users!inner(full_name))')
        .eq('user_id', userRow.id)
    : { data: [] };

  const students = (guardianLinks ?? []).map((g: any) => g.student).filter(Boolean);

  const { data: currentTerm } = await supabase
    .from('terms')
    .select('id, name')
    .eq('is_current', true)
    .maybeSingle();

  const { data: terms } = await supabase
    .from('terms')
    .select('id, name')
    .order('start_date', { ascending: false });

  const termId = searchParams.termId ?? currentTerm?.id ?? null;
  const activeStudentId = searchParams.studentId ?? students[0]?.id ?? null;
  const activeStudent = students.find((s: any) => s.id === activeStudentId) ?? students[0];

  let scores: any[] = [];
  if (activeStudentId && termId) {
    const { data } = await supabase
      .from('scores')
      .select('id, marks_obtained, comments, assessment:assessments!inner(id, name, max_marks, assessment_date, term:terms(id, name), subject:subjects(id, name, code), class:classes(name))')
      .eq('student_id', activeStudentId)
      .eq('assessments.term_id', termId)
      .order('created_at', { ascending: false });
    scores = data ?? [];
  }

  // Group by subject
  const bySubject: Record<string, { subjectName: string; subjectCode: string; rows: any[] }> = {};
  for (const row of scores) {
    const assessment = row.assessment as any;
    const subject = assessment?.subject;
    if (!subject) continue;
    let entry = bySubject[subject.id];
    if (!entry) {
      entry = { subjectName: subject.name, subjectCode: subject.code, rows: [] };
      bySubject[subject.id] = entry;
    }
    entry.rows.push(row);
  }

  const selectedTermName = (terms ?? []).find((t: any) => t.id === termId)?.name ?? 'this term';
  const childName = (activeStudent?.user as any)?.full_name ?? 'your child';

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <BackButton href="/parent" />
        <div>
          <h1 className="text-2xl font-semibold">Grades</h1>
          <p className="text-sm text-slate-500 mt-0.5">{childName}'s results for {selectedTermName}.</p>
        </div>
      </div>

      {students.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl px-5 py-12 text-center text-sm text-slate-400">
          No students linked to your account.
        </div>
      ) : (
        <>
          {/* Child tabs (if multiple children) */}
          {students.length > 1 && (
            <div className="flex gap-2 flex-wrap">
              {students.map((s: any) => (
                <a
                  key={s.id}
                  href={`/parent/grades?studentId=${s.id}${termId ? `&termId=${termId}` : ''}`}
                  className={`text-sm rounded-full px-3 py-1 font-medium transition-colors ${
                    s.id === activeStudentId
                      ? 'bg-violet-600 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {(s.user as any)?.full_name}
                </a>
              ))}
            </div>
          )}

          {/* Term filter + report card link */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            {(terms ?? []).length > 1 && (
              <div className="flex gap-2 flex-wrap">
                {(terms ?? []).map((t: any) => (
                  <a
                    key={t.id}
                    href={`/parent/grades?termId=${t.id}${activeStudentId ? `&studentId=${activeStudentId}` : ''}`}
                    className={`text-sm rounded-full px-3 py-1 font-medium transition-colors ${
                      t.id === termId
                        ? 'bg-slate-700 text-white'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {t.name}
                  </a>
                ))}
              </div>
            )}
            {activeStudentId && termId && (
              <Link
                href={`/report-card/${activeStudentId}?termId=${termId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-medium text-violet-700 border border-violet-300 bg-violet-50 hover:bg-violet-100 rounded-lg px-4 py-1.5 transition-colors"
              >
                Print Report Card
              </Link>
            )}
          </div>

          {scores.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl px-5 py-12 text-center text-sm text-slate-400">
              No grades recorded for {selectedTermName} yet.
            </div>
          ) : (
            <div className="space-y-6">
              {Object.values(bySubject).map((group) => {
                const totalMarks = group.rows.reduce((s, r) => s + Number(r.marks_obtained ?? 0), 0);
                const totalMax = group.rows.reduce((s, r) => s + (r.assessment?.max_marks ?? 0), 0);
                const pct = totalMax > 0 ? Math.round((totalMarks / totalMax) * 100) : null;
                const pctColor =
                  pct == null ? 'text-slate-500'
                  : pct >= 75 ? 'text-emerald-600'
                  : pct >= 50 ? 'text-amber-600'
                  : 'text-rose-600';

                return (
                  <div key={group.subjectCode} className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                    <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
                      <div>
                        <span className="font-semibold text-slate-800">{group.subjectName}</span>
                        <span className="ml-2 text-xs text-slate-400 font-mono">{group.subjectCode}</span>
                      </div>
                      {pct != null && (
                        <span className={`text-sm font-bold ${pctColor}`}>{pct}% overall</span>
                      )}
                    </div>
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50">
                        <tr>
                          <th className="text-left px-5 py-2 font-medium text-slate-500 text-xs">Assessment</th>
                          <th className="text-left px-5 py-2 font-medium text-slate-500 text-xs">Date</th>
                          <th className="text-right px-5 py-2 font-medium text-slate-500 text-xs">Marks</th>
                          <th className="text-right px-5 py-2 font-medium text-slate-500 text-xs">Out of</th>
                          <th className="text-right px-5 py-2 font-medium text-slate-500 text-xs">%</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {group.rows.map((row: any) => {
                          const a = row.assessment;
                          const m = row.marks_obtained;
                          const p = m != null ? Math.round((Number(m) / a.max_marks) * 100) : null;
                          const pc =
                            p == null ? 'text-slate-400'
                            : p >= 75 ? 'text-emerald-600'
                            : p >= 50 ? 'text-amber-600'
                            : 'text-rose-600';
                          return (
                            <tr key={row.id} className="hover:bg-slate-50">
                              <td className="px-5 py-2.5 font-medium text-slate-700">{a.name}</td>
                              <td className="px-5 py-2.5 text-slate-500">
                                {a.assessment_date ? new Date(a.assessment_date).toLocaleDateString() : '—'}
                              </td>
                              <td className="px-5 py-2.5 text-right font-semibold text-slate-800">
                                {m != null ? Number(m) : '—'}
                              </td>
                              <td className="px-5 py-2.5 text-right text-slate-500">{a.max_marks}</td>
                              <td className={`px-5 py-2.5 text-right font-semibold ${pc}`}>
                                {p != null ? `${p}%` : '—'}
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
        </>
      )}
    </div>
  );
}
