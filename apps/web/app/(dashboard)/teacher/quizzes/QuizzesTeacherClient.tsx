'use client';

import { Fragment, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { getCurrentUserRow } from '@/lib/supabase/currentUser';
import { apiFetch } from '@/lib/api';

type Quiz = {
  id: string; title: string; is_published: boolean; time_limit_mins: number | null;
  closes_at: string | null; class_id: string; subject_id: string | null;
  linkedAssessmentId: string | null;
  class: { name: string } | null; subject: { name: string } | null;
};
type ClassOption = { id: string; name: string };
type SubjectOption = { id: string; name: string };
type TermOption = { id: string; name: string; is_current: boolean; start_date: string; end_date: string };

type LinkPreview = {
  preview: true;
  kind: 'retroactive_rollup' | 'recompute';
  gradedCount: number;
  ungradedCount: number;
  sampleGrades: { studentName: string; normalizedScore: number }[];
};

// No due_at/available_from exists on quizzes — falls back to closes_at, then
// created_at (handled by the caller passing the right date in).
function inferTermId(dateStr: string | null, terms: TermOption[]): string {
  if (dateStr) {
    const d = new Date(dateStr);
    const match = terms.find((t) => d >= new Date(t.start_date) && d <= new Date(t.end_date));
    if (match) return match.id;
  }
  return terms.find((t) => t.is_current)?.id ?? terms[0]?.id ?? '';
}

export default function QuizzesTeacherClient({
  quizzes: initial, classes, subjects, terms,
}: {
  quizzes: Quiz[];
  classes: ClassOption[];
  subjects: SubjectOption[];
  terms: TermOption[];
}) {
  const supabase = createClient();
  const [quizzes, setQuizzes] = useState(initial);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [classId, setClassId] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [termId, setTermId] = useState(terms.find((t) => t.is_current)?.id ?? '');
  const [timeLimit, setTimeLimit] = useState('');
  const [countTowardGrade, setCountTowardGrade] = useState(false);
  const [assessmentName, setAssessmentName] = useState('');
  const [assessmentMaxMarks, setAssessmentMaxMarks] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [linkingId, setLinkingId] = useState<string | null>(null);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (countTowardGrade && !assessmentMaxMarks) {
      setError('Set max marks for the assessment before enabling "Count toward term grade".');
      return;
    }
    setSaving(true);
    setError('');
    const userRow = await getCurrentUserRow('id, school_id');
    const { data, error: dbError } = await supabase.from('quizzes').insert({
      school_id: userRow?.school_id,
      class_id: classId,
      subject_id: subjectId || null,
      term_id: termId || null,
      created_by_id: userRow?.id,
      title: title.trim(),
      time_limit_mins: timeLimit ? parseInt(timeLimit) : null,
    }).select('id, title, is_published, time_limit_mins, closes_at, class_id, subject_id, class:classes(name), subject:subjects(name)').single();

    if (dbError) { setError(`Failed to create quiz: ${dbError.message}`); setSaving(false); return; }
    if (data) {
      let linkedAssessmentId: string | null = null;
      if (countTowardGrade) {
        try {
          const link = await apiFetch<{ id: string }>(`/quizzes/${data.id}/link-to-gradebook`, {
            method: 'POST',
            body: JSON.stringify({
              name: assessmentName || title,
              subjectId: subjectId || undefined,
              classId,
              termId: termId || inferTermId(null, terms),
              maxMarks: Number(assessmentMaxMarks),
            }),
          });
          linkedAssessmentId = link.id;
        } catch (err) {
          setError(err instanceof Error ? `Quiz created, but linking failed: ${err.message}` : 'Quiz created, but linking failed');
        }
      }
      setQuizzes((p) => [{ ...data, linkedAssessmentId } as any, ...p]);
      setShowForm(false);
      setTitle(''); setClassId(''); setSubjectId(''); setTimeLimit('');
      setCountTowardGrade(false); setAssessmentName(''); setAssessmentMaxMarks('');
    }
    setSaving(false);
  }

  async function togglePublish(id: string, current: boolean) {
    await supabase.from('quizzes').update({ is_published: !current }).eq('id', id);
    setQuizzes((p) => p.map((q) => q.id === id ? { ...q, is_published: !current } : q));
  }

  async function handleUnlink(id: string) {
    if (!confirm('Unlinking keeps the assessment and its existing grades in the gradebook, but future quiz submissions won\'t update it. Continue?')) return;
    try {
      await apiFetch(`/quizzes/${id}/link-to-gradebook`, { method: 'DELETE' });
      setQuizzes((p) => p.map((q) => q.id === id ? { ...q, linkedAssessmentId: null } : q));
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Unlink failed');
    }
  }

  function handleLinked(id: string, assessmentId: string) {
    setQuizzes((p) => p.map((q) => q.id === id ? { ...q, linkedAssessmentId: assessmentId } : q));
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={() => setShowForm((v) => !v)}
          className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-700 transition-colors">
          {showForm ? 'Cancel' : '+ New quiz'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <h2 className="font-semibold text-slate-800">New quiz</h2>
          {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">{error}</p>}
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-1">Title</label>
              <input value={title} onChange={(e) => setTitle(e.target.value)} required
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Class</label>
              <select value={classId} onChange={(e) => setClassId(e.target.value)} required
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm">
                <option value="">Select…</option>
                {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Subject</label>
              <select value={subjectId} onChange={(e) => setSubjectId(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm">
                <option value="">None</option>
                {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Term</label>
              <select value={termId} onChange={(e) => setTermId(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm">
                <option value="">None</option>
                {terms.map((t) => <option key={t.id} value={t.id}>{t.name}{t.is_current ? ' (current)' : ''}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Time limit (mins, optional)</label>
              <input type="number" min="1" value={timeLimit} onChange={(e) => setTimeLimit(e.target.value)}
                placeholder="No limit"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
            <input type="checkbox" checked={countTowardGrade}
              onChange={(e) => setCountTowardGrade(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 accent-slate-900" />
            Count toward term grade
          </label>

          {countTowardGrade && (
            <div className="grid grid-cols-2 gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div>
                <label className="block text-xs font-medium text-slate-500">Assessment name</label>
                <input value={assessmentName} onChange={(e) => setAssessmentName(e.target.value)}
                  placeholder={title || 'Defaults to quiz title'}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500">Max marks for assessment</label>
                <input type="number" min="1" step="1" value={assessmentMaxMarks}
                  onChange={(e) => setAssessmentMaxMarks(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowForm(false)}
              className="px-4 py-2 rounded-lg text-sm text-slate-600 hover:bg-slate-100">Cancel</button>
            <button type="submit" disabled={saving}
              className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium disabled:opacity-50">
              {saving ? 'Creating…' : 'Create & add questions'}
            </button>
          </div>
        </form>
      )}

      {quizzes.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-white p-10 text-center text-sm text-slate-400">
          No quizzes yet. Create one above.
        </div>
      ) : (
        <div className="space-y-2">
          {quizzes.map((q) => (
            <Fragment key={q.id}>
              <div className="flex items-center gap-4 bg-white border border-slate-100 rounded-xl px-5 py-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-medium text-slate-800 truncate">{q.title}</p>
                    {q.linkedAssessmentId && (
                      <span className="text-xs bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded font-medium">Counts toward grade</span>
                    )}
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {(q.class as any)?.name ?? '—'}
                    {(q.subject as any)?.name ? ` · ${(q.subject as any).name}` : ''}
                    {q.time_limit_mins ? ` · ${q.time_limit_mins} min` : ''}
                  </p>
                </div>
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                  q.is_published ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'
                }`}>
                  {q.is_published ? 'Published' : 'Draft'}
                </span>
                <div className="flex gap-2">
                  <Link href={`/teacher/quizzes/${q.id}`}
                    className="text-xs border border-slate-200 px-3 py-1 rounded-lg hover:bg-slate-50 text-slate-600">
                    Edit questions
                  </Link>
                  <button onClick={() => togglePublish(q.id, q.is_published)}
                    className={`text-xs px-3 py-1 rounded-lg font-medium transition-colors ${
                      q.is_published
                        ? 'border border-slate-200 text-slate-600 hover:bg-slate-50'
                        : 'bg-emerald-600 text-white hover:bg-emerald-500'
                    }`}>
                    {q.is_published ? 'Unpublish' : 'Publish'}
                  </button>
                  {q.linkedAssessmentId ? (
                    <button onClick={() => handleUnlink(q.id)} className="text-xs border border-slate-200 px-3 py-1 rounded-lg hover:bg-slate-50 text-violet-600">
                      Unlink
                    </button>
                  ) : (
                    <button onClick={() => setLinkingId(linkingId === q.id ? null : q.id)} className="text-xs border border-slate-200 px-3 py-1 rounded-lg hover:bg-slate-50 text-violet-600">
                      Link to gradebook
                    </button>
                  )}
                </div>
              </div>
              {linkingId === q.id && (
                <RetrofitLinkForm
                  quiz={q} subjects={subjects} classes={classes} terms={terms}
                  onDone={(assessmentId) => { handleLinked(q.id, assessmentId); setLinkingId(null); }}
                  onCancel={() => setLinkingId(null)}
                />
              )}
            </Fragment>
          ))}
        </div>
      )}
    </div>
  );
}

function RetrofitLinkForm({
  quiz, subjects, classes, terms, onDone, onCancel,
}: {
  quiz: Quiz;
  subjects: SubjectOption[];
  classes: ClassOption[];
  terms: TermOption[];
  onDone: (assessmentId: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(quiz.title);
  const [subjectId, setSubjectId] = useState(quiz.subject_id ?? '');
  const [classId, setClassId] = useState(quiz.class_id);
  const [termId, setTermId] = useState(inferTermId(quiz.closes_at, terms));
  const [maxMarks, setMaxMarks] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<LinkPreview | null>(null);

  async function submit(confirmed: boolean) {
    if (!subjectId || !classId || !termId || !maxMarks) {
      setError('Fill in all fields.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const res = await apiFetch<LinkPreview | { id: string }>(`/quizzes/${quiz.id}/link-to-gradebook`, {
        method: 'POST',
        body: JSON.stringify({ name, subjectId, classId, termId, maxMarks: Number(maxMarks), confirmed: confirmed || undefined }),
      });
      if ('preview' in res && res.preview) {
        setPreview(res);
      } else {
        onDone((res as { id: string }).id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Link failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-lg border border-violet-200 bg-violet-50 px-4 py-3 space-y-3">
      <p className="text-sm font-medium text-slate-700">Link to gradebook</p>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-xs font-medium text-slate-500">Assessment name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500">Max marks</label>
          <input type="number" min="1" step="1" value={maxMarks} onChange={(e) => setMaxMarks(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500">Subject</label>
          <select value={subjectId} onChange={(e) => setSubjectId(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm">
            <option value="">Select subject</option>
            {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500">Term</label>
          <select value={termId} onChange={(e) => setTermId(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm">
            {terms.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div className="col-span-2">
          <label className="block text-xs font-medium text-slate-500">Class</label>
          <select value={classId} onChange={(e) => setClassId(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm">
            {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-white">Cancel</button>
        <button onClick={() => submit(false)} disabled={saving} className="rounded-md bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-700 disabled:opacity-50">
          {saving ? 'Linking…' : 'Link'}
        </button>
      </div>

      {preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4" onClick={() => setPreview(null)}>
          <div role="dialog" aria-modal="true" aria-labelledby="quiz-rollup-title"
            className="w-full max-w-md rounded-xl bg-white shadow-xl p-6 space-y-3" onClick={(e) => e.stopPropagation()}>
            <h3 id="quiz-rollup-title" className="text-lg font-semibold">
              {preview.kind === 'recompute' ? 'Recompute existing grades?' : 'Create gradebook entries?'}
            </h3>
            <p className="text-sm text-slate-600">
              {preview.kind === 'recompute'
                ? `Changing the max marks will recompute existing gradebook entries. This will affect ${preview.gradedCount} student${preview.gradedCount === 1 ? '' : 's'}.`
                : `This will create gradebook entries for the ${preview.gradedCount} student${preview.gradedCount === 1 ? '' : 's'} who have submitted. ${preview.ungradedCount} student${preview.ungradedCount === 1 ? '' : 's'} without a submission won't get an entry until they submit.`}
            </p>
            {preview.sampleGrades.length > 0 && (
              <ul className="text-sm text-slate-700 space-y-0.5 max-h-40 overflow-y-auto">
                {preview.sampleGrades.map((g, i) => (
                  <li key={i}>{g.studentName}: {g.normalizedScore}/{maxMarks}</li>
                ))}
                {preview.gradedCount > preview.sampleGrades.length && (
                  <li className="text-slate-400">and {preview.gradedCount - preview.sampleGrades.length} more…</li>
                )}
              </ul>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setPreview(null)} className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                Cancel
              </button>
              <button
                onClick={() => { setPreview(null); submit(true); }}
                className="rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700"
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
