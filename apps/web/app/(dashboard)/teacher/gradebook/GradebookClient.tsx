'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { getCurrentUserRow } from '@/lib/supabase/currentUser';
import { createClient } from '@/lib/supabase/client';
import { calculateSubjectAverage } from '@school-manager/types';

type ClassItem  = { id: string; name: string; grade_level: number };
type Subject    = { id: string; name: string };
type Term       = { id: string; name: string; is_current: boolean };
type Assessment = { id: string; name: string; max_marks: number; assessment_date: string | null; source_type: 'DIRECT' | 'HOMEWORK' | 'QUIZ'; source_id: string | null };
type Student    = { id: string; user: { full_name: string } };
type Grade      = { student_id: string; score: number | null; comment: string | null };

export default function GradebookClient({
  teacherId, myClasses, subjects, terms, currentTermId,
}: {
  teacherId: string;
  myClasses: ClassItem[];
  subjects: Subject[];
  terms: Term[];
  currentTermId: string;
}) {
  const supabase = createClient();

  const [classId, setClassId]   = useState(myClasses[0]?.id ?? '');
  const [subjectId, setSubjectId] = useState('');
  const [termId, setTermId]     = useState(currentTermId);

  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [students, setStudents]       = useState<Student[]>([]);
  const [grades, setGrades]           = useState<Record<string, Record<string, number | null>>>({});
  const [loading, setLoading]         = useState(false);

  // New assessment form
  const [showForm, setShowForm]   = useState(false);
  const [aName, setAName]         = useState('');
  const [aMax, setAMax]           = useState('100');
  const [aDate, setADate]         = useState('');
  const [creating, setCreating]   = useState(false);
  const [formError, setFormError] = useState('');

  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const load = useCallback(async () => {
    if (!classId || !subjectId) return;
    setLoading(true);
    const [{ data: aData }, { data: sData }] = await Promise.all([
      supabase.from('assessments')
        .select('id, name, max_marks, assessment_date, source_type, source_id')
        .eq('class_id', classId).eq('subject_id', subjectId).eq('term_id', termId)
        .order('assessment_date', { ascending: true }),
      supabase.from('students')
        .select('id, user:users!user_id(full_name)')
        .eq('current_class_id', classId).eq('is_active', true)
        .order('id'),
    ]);
    setAssessments((aData ?? []) as Assessment[]);
    setStudents((sData ?? []) as unknown as Student[]);

    // Load grades for all assessments
    const assessmentIds = (aData ?? []).map((a) => a.id);
    if (assessmentIds.length > 0) {
      const { data: gData } = await supabase
        .from('grades')
        .select('assessment_id, student_id, score, comment')
        .in('assessment_id', assessmentIds);
      const map: Record<string, Record<string, number | null>> = {};
      for (const g of gData ?? []) {
        (map[g.assessment_id] ??= {})[g.student_id] = g.score;
      }
      setGrades(map);
    } else {
      setGrades({});
    }
    setLoading(false);
  }, [classId, subjectId, termId, supabase]);

  useEffect(() => { load(); }, [load]);

  async function createAssessment(e: React.FormEvent) {
    e.preventDefault();
    if (!classId || !subjectId) return;

    // BUG-9: parseFloat(aMax) || 100 only catches falsy results (0/NaN/'') —
    // a genuinely negative value like "-5" is truthy and would slip through.
    const maxMarks = aMax.trim() === '' ? 100 : parseFloat(aMax);
    if (isNaN(maxMarks) || maxMarks <= 0) {
      setFormError('Max score must be a positive number.');
      return;
    }
    setFormError('');

    setCreating(true);
    const userRow = await getCurrentUserRow('id, school_id');
    await supabase.from('assessments').insert({
      school_id: userRow?.school_id,
      class_id: classId,
      subject_id: subjectId,
      term_id: termId || null,
      teacher_id: teacherId,
      name: aName.trim(),
      max_marks: maxMarks,
      assessment_date: aDate || null,
    });
    setAName(''); setADate(''); setShowForm(false); setCreating(false);
    load();
  }

  function handleScoreChange(assessmentId: string, studentId: string, val: string) {
    const score = val === '' ? null : parseFloat(val);
    setGrades((prev) => ({
      ...prev,
      [assessmentId]: { ...(prev[assessmentId] ?? {}), [studentId]: isNaN(score as number) ? null : score },
    }));

    // Debounced autosave
    const key = `${assessmentId}:${studentId}`;
    if (saveTimers.current[key]) clearTimeout(saveTimers.current[key]);
    saveTimers.current[key] = setTimeout(async () => {
      const { data: userRow } = await supabase.from('users').select('id, school_id').maybeSingle();
      await supabase.from('grades').upsert({
        school_id: userRow?.school_id,
        assessment_id: assessmentId,
        student_id: studentId,
        score: score,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'assessment_id,student_id' });
    }, 800);
  }

  function classAvg(assessmentId: string, maxMarks: number): string {
    const scores = students
      .map((s) => grades[assessmentId]?.[s.id])
      .filter((v): v is number => typeof v === 'number');
    if (!scores.length) return '—';
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    return `${avg.toFixed(1)} / ${maxMarks}`;
  }

  function studentAvg(studentId: string): string {
    const scored = assessments
      .map((a) => ({ score: grades[a.id]?.[studentId] ?? null, maxMarks: a.max_marks }))
      .filter((x): x is { score: number; maxMarks: number } => typeof x.score === 'number');
    const avgPct = calculateSubjectAverage(scored);
    return avgPct != null ? `${avgPct.toFixed(1)}%` : '—';
  }

  const filteredSubjects = subjects; // all subjects (teacher can enter grades for any)

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-3 bg-white border border-slate-200 rounded-xl p-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="gradebook-class" className="text-xs font-medium text-slate-500 uppercase tracking-wide">Class</label>
          <select id="gradebook-class" value={classId} onChange={(e) => setClassId(e.target.value)}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm min-w-[140px]">
            {myClasses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="gradebook-subject" className="text-xs font-medium text-slate-500 uppercase tracking-wide">Subject</label>
          <select id="gradebook-subject" value={subjectId} onChange={(e) => setSubjectId(e.target.value)}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm min-w-[140px]">
            <option value="">Select subject…</option>
            {filteredSubjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="gradebook-term" className="text-xs font-medium text-slate-500 uppercase tracking-wide">Term</label>
          <select id="gradebook-term" value={termId} onChange={(e) => setTermId(e.target.value)}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm min-w-[140px]">
            {terms.map((t) => <option key={t.id} value={t.id}>{t.name}{t.is_current ? ' (current)' : ''}</option>)}
          </select>
        </div>
      </div>

      {subjectId && classId && (
        <>
          {/* Add assessment */}
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h2 className="text-sm font-semibold text-slate-700">Assessments &amp; grades</h2>
            <div className="flex gap-2">
              {assessments.length > 0 && students.length > 0 && (
                <button
                  onClick={() => {
                    const header = ['Student', ...assessments.map((a) => `${a.name} (/${a.max_marks})`), 'Avg %'];
                    const rows = students.map((s) => [
                      (s.user as any)?.full_name ?? '',
                      ...assessments.map((a) => {
                        const sc = grades[a.id]?.[s.id];
                        return typeof sc === 'number' ? sc : '';
                      }),
                      studentAvg(s.id),
                    ]);
                    const csv = [header, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
                    const blob = new Blob([csv], { type: 'text/csv' });
                    const a = document.createElement('a');
                    a.href = URL.createObjectURL(blob);
                    a.download = `gradebook-${classId}-${subjectId}.csv`;
                    a.click();
                  }}
                  className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-sm text-slate-600 hover:bg-slate-50 transition-colors"
                >
                  ↓ Export CSV
                </button>
              )}
              <button
                onClick={() => setShowForm((v) => !v)}
                className="px-3 py-1.5 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-700 transition-colors"
              >
                {showForm ? 'Cancel' : '+ Add assessment'}
              </button>
            </div>
          </div>

          {showForm && (
            <form onSubmit={createAssessment}
              className="bg-white border border-slate-200 rounded-xl p-4 grid grid-cols-2 sm:grid-cols-3 gap-3">
              {formError && (
                <p className="col-span-2 sm:col-span-3 text-sm text-red-600" role="alert">{formError}</p>
              )}
              <div className="col-span-2 sm:col-span-1">
                <label htmlFor="assessment-name" className="block text-xs font-medium text-slate-500 mb-1">Name</label>
                <input id="assessment-name" value={aName} onChange={(e) => setAName(e.target.value)} required
                  placeholder="e.g. Mid-term Exam" aria-label="Assessment name"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
              </div>
              <div>
                <label htmlFor="assessment-max-score" className="block text-xs font-medium text-slate-500 mb-1">Max score</label>
                <input id="assessment-max-score" type="number" min="1" value={aMax} onChange={(e) => setAMax(e.target.value)}
                  aria-label="Max score"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
              </div>
              <div>
                <label htmlFor="assessment-date" className="block text-xs font-medium text-slate-500 mb-1">Date</label>
                <input id="assessment-date" type="date" value={aDate} onChange={(e) => setADate(e.target.value)}
                  aria-label="Assessment date"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
              </div>
              <div className="flex items-end">
                <button type="submit" disabled={creating}
                  className="w-full rounded-lg bg-slate-900 text-white px-4 py-2 text-sm font-medium hover:bg-slate-700 disabled:opacity-50">
                  {creating ? 'Creating…' : 'Create'}
                </button>
              </div>
            </form>
          )}

          {loading ? (
            <div className="text-center py-10 text-sm text-slate-500">Loading…</div>
          ) : assessments.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
              No assessments yet. Add one above.
            </div>
          ) : (
            /* Spreadsheet grid */
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
              <table className="min-w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    <th className="sticky left-0 z-10 bg-slate-50 px-4 py-3 text-left font-medium text-slate-600 min-w-[160px]">
                      Student
                    </th>
                    {assessments.map((a) => (
                      <th key={a.id} className="px-3 py-3 text-center font-medium text-slate-600 min-w-[100px]">
                        <div>{a.name}</div>
                        <div className="text-xs font-normal text-slate-500">/{a.max_marks}</div>
                        {a.assessment_date && <div className="text-xs font-normal text-slate-500">{new Date(a.assessment_date).toLocaleDateString('en-KE', { day:'numeric', month:'short' })}</div>}
                        {a.source_type !== 'DIRECT' && (
                          <div
                            className="mt-1 inline-block text-[10px] font-medium text-violet-700 bg-violet-50 border border-violet-200 rounded px-1.5 py-0.5"
                            title={`Derived from a ${a.source_type.toLowerCase()} — grades are read-only here. Update the source instead.`}
                          >
                            🔒 {a.source_type === 'HOMEWORK' ? 'Homework' : 'Quiz'}
                          </div>
                        )}
                      </th>
                    ))}
                    <th className="px-4 py-3 text-center font-medium text-slate-600 min-w-[80px]">Avg</th>
                  </tr>
                </thead>
                <tbody>
                  {students.map((s, si) => (
                    <tr key={s.id} className={`border-b border-slate-100 ${si % 2 === 1 ? 'bg-slate-50/40' : ''}`}>
                      <td className="sticky left-0 z-10 bg-inherit px-4 py-2 font-medium text-slate-800 truncate max-w-[160px]">
                        {(s.user as any)?.full_name ?? '—'}
                      </td>
                      {assessments.map((a) => {
                        const score = grades[a.id]?.[s.id];
                        const pct = typeof score === 'number' ? (score / a.max_marks) * 100 : null;
                        const color = pct === null ? '' : pct >= 70 ? 'text-emerald-700' : pct >= 50 ? 'text-amber-600' : 'text-rose-600';
                        if (a.source_type !== 'DIRECT') {
                          return (
                            <td key={a.id} className="px-2 py-1.5 text-center">
                              <span
                                className={`inline-block w-16 rounded-lg border border-dashed border-slate-200 px-2 py-1 text-center text-sm bg-slate-50 ${color}`}
                                title={`Derived from a ${a.source_type.toLowerCase()} — read-only. Update the source instead.`}
                              >
                                {typeof score === 'number' ? score : '—'}
                              </span>
                            </td>
                          );
                        }
                        return (
                          <td key={a.id} className="px-2 py-1.5 text-center">
                            <input
                              type="number"
                              min={0}
                              max={a.max_marks}
                              step="0.5"
                              value={typeof score === 'number' ? score : ''}
                              onChange={(e) => handleScoreChange(a.id, s.id, e.target.value)}
                              aria-label={`${(s.user as any)?.full_name ?? 'Student'} — ${a.name}`}
                              className={`w-16 rounded-lg border border-slate-200 px-2 py-1 text-center text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 ${color}`}
                              placeholder="—"
                            />
                          </td>
                        );
                      })}
                      <td className="px-4 py-2 text-center text-sm font-medium text-slate-600">
                        {studentAvg(s.id)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-slate-200 bg-slate-50 font-medium">
                    <td className="sticky left-0 z-10 bg-slate-50 px-4 py-2 text-slate-600">Class avg</td>
                    {assessments.map((a) => (
                      <td key={a.id} className="px-4 py-2 text-center text-slate-600 text-xs">
                        {classAvg(a.id, a.max_marks)}
                      </td>
                    ))}
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </>
      )}

      {!subjectId && (
        <div className="rounded-xl border border-dashed border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
          Select a class and subject above to open the gradebook.
        </div>
      )}
    </div>
  );
}
