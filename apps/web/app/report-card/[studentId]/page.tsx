import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { assignLetterGrade, calculateStudentTermAverage } from '@school-manager/types';
import { fetchStudentTermAverage } from '@/lib/grading/fetchStudentTermAverage';
import { PrintButton } from './PrintButton';

export default async function ReportCardPage({
  params,
  searchParams,
}: {
  params: { studentId: string };
  searchParams: { termId?: string };
}) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { studentId } = params;
  const { termId: rawTermId } = searchParams;

  const [
    { data: school },
    { data: student },
  ] = await Promise.all([
    supabase.from('schools').select('name').single(),
    supabase
      .from('students')
      .select('id, admission_no, user:users!inner(full_name), class:classes(name)')
      .eq('id', studentId)
      .maybeSingle(),
  ]);

  if (!student) return notFound();

  // Resolve term
  const { data: term } = rawTermId
    ? await supabase.from('terms').select('id, name, start_date, end_date').eq('id', rawTermId).maybeSingle()
    : await supabase.from('terms').select('id, name, start_date, end_date').eq('is_current', true).maybeSingle();

  const termId = term?.id;

  // Fetch scores
  const { data: rawScores } = termId
    ? await supabase
        .from('grades')
        .select('id, marks_obtained:score, comments:comment, assessment:assessments!inner(id, name, max_marks, assessment_date, subject:subjects(id, name, code))')
        .eq('student_id', studentId)
        .eq('assessments.term_id', termId)
        .order('created_at', { ascending: true })
    : { data: [] };

  const scores = rawScores ?? [];

  // Group by subject
  const bySubject: Record<string, {
    subjectName: string;
    subjectCode: string;
    rows: typeof scores;
  }> = {};
  for (const row of scores) {
    const a = row.assessment as any;
    const sub = a?.subject;
    if (!sub) continue;
    let entry = bySubject[sub.id];
    if (!entry) {
      entry = { subjectName: sub.name, subjectCode: sub.code, rows: [] };
      bySubject[sub.id] = entry;
    }
    entry.rows.push(row);
  }

  const subjectGroups = Object.values(bySubject);

  // Per-subject and overall averages — via the shared calculateStudentTermAverage
  // (packages/types/src/grading.ts), which unions `grades` with any homework/
  // quiz scores never linked into the gradebook, and averages per-assessment
  // rather than per-subject-then-averaged. Shared with
  // print/report-card/[studentId]/page.tsx via @school-manager/types.
  // subjectGroups (built from `grades` alone, above) still drives the
  // per-assessment row listing below — only the displayed averages come from
  // the fuller, shared calculation.
  const termAverageInput = termId
    ? await fetchStudentTermAverage(supabase, { studentId, termId })
    : { gradesFromGradebook: [], homeworkCompletions: [], quizAttempts: [] };
  const termAverage = calculateStudentTermAverage(termAverageInput);
  const avgBySubjectId = new Map(termAverage.by_subject.map((s) => [s.subject_id, s.average_percentage]));
  const subjectAverages = subjectGroups.map((g) => {
    const a = g.rows[0]?.assessment as any;
    const subjectId = a?.subject?.id;
    return subjectId ? avgBySubjectId.get(subjectId) ?? null : null;
  });
  const scoredSubjectAverages = subjectAverages.filter((a): a is number => a != null);
  const grandPct = termAverage.overall_average_percentage;

  const studentName = (student.user as any)?.full_name ?? '—';
  const className = (student.class as any)?.name ?? '—';
  const printedDate = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <div className="min-h-screen bg-slate-100 print:bg-white print:p-0">
      {/* Button bar — hidden when printing */}
      <div className="print:hidden bg-white border-b border-slate-200 px-6 py-3 flex items-center gap-3">
        <Link
          href={`/student/grades`}
          className="text-sm text-slate-500 hover:text-slate-800 transition-colors"
        >
          ← Back
        </Link>
        <PrintButton />
        <span className="text-xs text-slate-400 ml-2">
          Tip: In the print dialog, choose "Save as PDF" and set margins to None for best results.
        </span>
      </div>

      {/* Report card body */}
      <div className="max-w-3xl mx-auto my-8 bg-white shadow-sm rounded-xl overflow-hidden print:shadow-none print:rounded-none print:my-0 print:max-w-none">

        {/* School header */}
        <div className="bg-slate-800 text-white px-8 py-6 text-center print:bg-slate-800 print:text-white">
          <p className="text-xs font-medium tracking-widest uppercase text-slate-300 mb-1">
            {school?.name ?? 'School Name'}
          </p>
          <h1 className="text-2xl font-bold tracking-wide">Academic Report Card</h1>
          {term && (
            <p className="text-slate-300 text-sm mt-1">{term.name}</p>
          )}
        </div>

        {/* Student info strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 border-b border-slate-200 divide-x divide-slate-200 text-sm">
          {[
            { label: 'Student', value: studentName },
            { label: 'Admission No.', value: student.admission_no },
            { label: 'Class', value: className },
            { label: 'Term', value: term?.name ?? '—' },
          ].map(({ label, value }) => (
            <div key={label} className="px-5 py-3">
              <p className="text-xs text-slate-400 uppercase tracking-wide font-medium">{label}</p>
              <p className="font-semibold text-slate-800 mt-0.5">{value}</p>
            </div>
          ))}
        </div>

        {/* Grades */}
        <div className="px-8 py-6 space-y-6">
          {subjectGroups.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-8">
              No assessment results recorded for this term.
            </p>
          ) : (
            subjectGroups.map((group, i) => {
              // Marks/Out of are raw informational sums — the % and grade
              // columns are driven by the shared unweighted-mean formula
              // (subjectAverages[i]), not by these sums, since the two no
              // longer compute the same thing (see the module comment above).
              const subjectMarks = group.rows.reduce((s, r) => s + Number(r.marks_obtained ?? 0), 0);
              const subjectMax = group.rows.reduce((s, r) => s + ((r.assessment as any)?.max_marks ?? 0), 0);
              const subjectAvg = subjectAverages[i] ?? null;
              const subjectPct = subjectAvg != null ? Math.round(subjectAvg) : null;
              const grade = subjectAvg != null ? assignLetterGrade(subjectAvg) : '—';

              return (
                <div key={group.subjectCode} className="border border-slate-200 rounded-lg overflow-hidden">
                  {/* Subject heading */}
                  <div className="bg-slate-50 border-b border-slate-200 px-4 py-2 flex items-center justify-between">
                    <span className="font-semibold text-slate-800 text-sm">
                      {group.subjectName}
                    </span>
                    <span className="text-xs text-slate-400 font-mono">{group.subjectCode}</span>
                  </div>

                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs text-slate-500 uppercase tracking-wide border-b border-slate-100">
                        <th className="text-left px-4 py-2 font-medium">Assessment</th>
                        <th className="text-left px-4 py-2 font-medium">Date</th>
                        <th className="text-right px-4 py-2 font-medium">Marks</th>
                        <th className="text-right px-4 py-2 font-medium">Out of</th>
                        <th className="text-right px-4 py-2 font-medium">%</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {group.rows.map((row: any) => {
                        const a = row.assessment;
                        const m = row.marks_obtained;
                        const p = m != null ? Math.round((Number(m) / a.max_marks) * 100) : null;
                        return (
                          <tr key={row.id}>
                            <td className="px-4 py-2 text-slate-700">{a.name}</td>
                            <td className="px-4 py-2 text-slate-500">
                              {a.assessment_date
                                ? new Date(a.assessment_date).toLocaleDateString('en-GB')
                                : '—'}
                            </td>
                            <td className="px-4 py-2 text-right font-medium text-slate-800">
                              {m != null ? Number(m) : '—'}
                            </td>
                            <td className="px-4 py-2 text-right text-slate-500">{a.max_marks}</td>
                            <td className="px-4 py-2 text-right text-slate-600">
                              {p != null ? `${p}%` : '—'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    {/* Subject total row */}
                    <tfoot>
                      <tr className="bg-slate-50 border-t border-slate-200 font-semibold">
                        <td className="px-4 py-2 text-slate-700" colSpan={2}>Subject Total</td>
                        <td className="px-4 py-2 text-right text-slate-800">{subjectMarks}</td>
                        <td className="px-4 py-2 text-right text-slate-600">{subjectMax}</td>
                        <td className="px-4 py-2 text-right">
                          {subjectPct != null ? (
                            <span className={
                              subjectPct >= 70 ? 'text-emerald-700' :
                              subjectPct >= 50 ? 'text-amber-700' :
                              'text-rose-700'
                            }>
                              {subjectPct}% &nbsp;<span className="font-bold">{grade}</span>
                            </span>
                          ) : '—'}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              );
            })
          )}

          {/* Overall summary */}
          {grandPct != null && (
            <div className="border-2 border-slate-800 rounded-lg px-6 py-4 flex items-center justify-between">
              <div>
                <p className="text-xs text-slate-500 uppercase tracking-wide font-medium">Overall Performance</p>
                <p className="text-2xl font-bold text-slate-800 mt-0.5">
                  {scoredSubjectAverages.length} subject{scoredSubjectAverages.length === 1 ? '' : 's'} averaged
                </p>
              </div>
              <div className="text-right">
                <p className="text-4xl font-bold text-slate-800">{Math.round(grandPct)}%</p>
                <p className="text-lg font-semibold text-slate-500">Grade {assignLetterGrade(grandPct)}</p>
              </div>
            </div>
          )}

          {/* Grade scale legend */}
          <div className="flex flex-wrap gap-3 text-xs text-slate-500">
            {[
              { label: 'A', range: '80–100%' },
              { label: 'B', range: '70–79%' },
              { label: 'C', range: '60–69%' },
              { label: 'D', range: '50–59%' },
              { label: 'E', range: 'Below 50%' },
            ].map(({ label, range }) => (
              <span key={label} className="bg-slate-50 border border-slate-200 rounded px-2 py-0.5">
                <strong>{label}</strong> = {range}
              </span>
            ))}
          </div>

          {/* Footer: signature lines */}
          <div className="grid grid-cols-2 gap-8 pt-6 border-t border-slate-200 mt-2">
            <div>
              <div className="border-b border-slate-400 mb-1 h-8" />
              <p className="text-xs text-slate-500">Class Teacher</p>
            </div>
            <div>
              <div className="border-b border-slate-400 mb-1 h-8" />
              <p className="text-xs text-slate-500">Principal / Head Teacher</p>
            </div>
          </div>

          <p className="text-xs text-slate-400 text-center pt-2">
            Printed: {printedDate}
          </p>
        </div>
      </div>
    </div>
  );
}
