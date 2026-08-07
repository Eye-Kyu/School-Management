'use client';

import { Fragment, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';

type Assignment = {
  id: string;
  title: string;
  description: string | null;
  due_date: string;
  class_id: string;
  subject_id: string | null;
  max_score: number | null;
  linkedAssessmentId: string | null;
  class: { name: string } | null;
  subject: { name: string } | null;
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

function isOverdue(dueDate: string) {
  return new Date(dueDate) < new Date(new Date().toDateString());
}

// Best-effort term match for a given date, falling back to the current term.
function inferTermId(dateStr: string, terms: TermOption[]): string {
  const d = new Date(dateStr);
  const match = terms.find((t) => d >= new Date(t.start_date) && d <= new Date(t.end_date));
  return match?.id ?? terms.find((t) => t.is_current)?.id ?? terms[0]?.id ?? '';
}

export default function HomeworkClient({
  assignments: initial,
  classes,
  subjects,
  terms,
}: {
  assignments: Assignment[];
  classes: ClassOption[];
  subjects: SubjectOption[];
  terms: TermOption[];
}) {
  const router = useRouter();
  const [assignments, setAssignments] = useState(initial);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [classId, setClassId] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [maxScore, setMaxScore] = useState('');
  const [countTowardGrade, setCountTowardGrade] = useState(false);
  const [assessmentName, setAssessmentName] = useState('');
  const [assessmentMaxMarks, setAssessmentMaxMarks] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function openForm() {
    setTitle(''); setDescription(''); setClassId(classes[0]?.id ?? '');
    setSubjectId(''); setDueDate(''); setMaxScore('');
    setCountTowardGrade(false); setAssessmentName(''); setAssessmentMaxMarks('');
    setError('');
    setShowForm(true);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (countTowardGrade && !maxScore) {
      setError('Set a max score before enabling "Count toward term grade".');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const created = await apiFetch<Assignment>('/homework', {
        method: 'POST',
        body: JSON.stringify({
          classId, subjectId: subjectId || undefined,
          title, description: description || undefined, dueDate,
          maxScore: maxScore ? Number(maxScore) : undefined,
        }),
      });
      let linkedAssessmentId: string | null = null;
      if (countTowardGrade) {
        const link = await apiFetch<{ id: string }>(`/homework/${created.id}/link-to-gradebook`, {
          method: 'POST',
          body: JSON.stringify({
            name: assessmentName || title,
            subjectId: subjectId || undefined,
            classId,
            termId: inferTermId(dueDate, terms),
            maxMarks: Number(assessmentMaxMarks || maxScore),
          }),
        });
        linkedAssessmentId = link.id;
      }
      setAssignments((prev) => [...prev, { ...created, linkedAssessmentId }].sort((a, b) => a.due_date.localeCompare(b.due_date)));
      setShowForm(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this homework assignment?')) return;
    try {
      await apiFetch(`/homework/${id}`, { method: 'DELETE' });
      setAssignments((prev) => prev.filter((a) => a.id !== id));
      router.refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Delete failed');
    }
  }

  async function handleUnlink(id: string) {
    if (!confirm('Unlinking keeps the assessment and its existing grades in the gradebook, but future homework grades won\'t update it. Continue?')) return;
    try {
      await apiFetch(`/homework/${id}/link-to-gradebook`, { method: 'DELETE' });
      setAssignments((prev) => prev.map((a) => a.id === id ? { ...a, linkedAssessmentId: null } : a));
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Unlink failed');
    }
  }

  function handleLinked(id: string, assessmentId: string) {
    setAssignments((prev) => prev.map((a) => a.id === id ? { ...a, linkedAssessmentId: assessmentId } : a));
  }

  const today = new Date().toDateString();
  const upcoming = assignments.filter((a) => new Date(a.due_date) >= new Date(today));
  const past = assignments.filter((a) => new Date(a.due_date) < new Date(today));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">{assignments.length} assignment{assignments.length !== 1 ? 's' : ''}</p>
        <button
          onClick={openForm}
          className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 transition-colors"
        >
          Assign homework
        </button>
      </div>

      {assignments.length === 0 && (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center text-slate-400 text-sm">
          No homework assigned yet.
        </div>
      )}

      {upcoming.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide">Upcoming / Active</h2>
          <AssignmentList items={upcoming} subjects={subjects} classes={classes} terms={terms} onDelete={handleDelete} onUnlink={handleUnlink} onLinked={handleLinked} />
        </section>
      )}

      {past.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide">Past</h2>
          <AssignmentList items={past} subjects={subjects} classes={classes} terms={terms} onDelete={handleDelete} onUnlink={handleUnlink} onLinked={handleLinked} />
        </section>
      )}

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white shadow-xl p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-semibold">Assign homework</h2>
            <p className="text-sm text-slate-500">Physical homework — describe what students should do on paper. No file upload needed.</p>
            {error && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">{error}</p>
            )}
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700">Title / instruction</label>
                <input
                  required placeholder="e.g. Workbook pg 24–26" value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">Additional notes (optional)</label>
                <textarea
                  rows={2} value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Any extra details for students…"
                  className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none resize-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700">Class</label>
                  <select
                    required value={classId} onChange={(e) => setClassId(e.target.value)}
                    className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
                  >
                    <option value="">Select class</option>
                    {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700">Subject (optional)</label>
                  <select
                    value={subjectId} onChange={(e) => setSubjectId(e.target.value)}
                    className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
                  >
                    <option value="">— none —</option>
                    {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700">Due date</label>
                  <input
                    required type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)}
                    className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700">Max score (optional)</label>
                  <input
                    type="number" min="1" step="any" value={maxScore} onChange={(e) => setMaxScore(e.target.value)}
                    placeholder="e.g. 10"
                    className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
                  />
                </div>
              </div>

              <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                <input type="checkbox" checked={countTowardGrade}
                  onChange={(e) => setCountTowardGrade(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 accent-slate-900" />
                Count toward term grade
              </label>

              {countTowardGrade && (
                <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-500">Assessment name</label>
                    <input
                      value={assessmentName} onChange={(e) => setAssessmentName(e.target.value)}
                      placeholder={title || 'Defaults to homework title'}
                      className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-500">Max marks for assessment</label>
                    <input
                      type="number" min="1" step="1" value={assessmentMaxMarks}
                      onChange={(e) => setAssessmentMaxMarks(e.target.value)}
                      placeholder={maxScore || 'Defaults to max score above'}
                      className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    />
                  </div>
                  <p className="text-xs text-slate-400">Term and class are inferred from this homework; edit the class/subject above if needed.</p>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setShowForm(false)}
                  className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors">
                  Cancel
                </button>
                <button type="submit" disabled={saving}
                  className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50 transition-colors">
                  {saving ? 'Saving…' : 'Assign'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function AssignmentList({
  items, subjects, classes, terms, onDelete, onUnlink, onLinked,
}: {
  items: Assignment[];
  subjects: SubjectOption[];
  classes: ClassOption[];
  terms: TermOption[];
  onDelete: (id: string) => void;
  onUnlink: (id: string) => void;
  onLinked: (id: string, assessmentId: string) => void;
}) {
  const [linkingId, setLinkingId] = useState<string | null>(null);

  return (
    <div className="space-y-2">
      {items.map((a) => (
        <Fragment key={a.id}>
          <div className="flex items-start justify-between rounded-lg border border-slate-200 bg-white px-4 py-3">
            <div className="space-y-0.5 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium text-slate-800 text-sm">{a.title}</span>
                {a.subject && (
                  <span className="text-xs bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">{a.subject.name}</span>
                )}
                {a.linkedAssessmentId && (
                  <span className="text-xs bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded font-medium">Counts toward grade</span>
                )}
              </div>
              {a.description && <p className="text-xs text-slate-500 truncate">{a.description}</p>}
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <span>{a.class?.name}</span>
                <span>·</span>
                <span className={isOverdue(a.due_date) ? 'text-red-500 font-medium' : ''}>
                  Due {new Date(a.due_date).toLocaleDateString('en-KE', { day: 'numeric', month: 'short' })}
                </span>
              </div>
            </div>
            <div className="ml-3 shrink-0 flex items-center gap-3">
              <Link href={`/teacher/homework/${a.id}`} className="text-xs text-slate-500 hover:text-slate-800">
                Grade submissions
              </Link>
              {a.linkedAssessmentId ? (
                <button onClick={() => onUnlink(a.id)} className="text-xs text-violet-600 hover:text-violet-800">Unlink</button>
              ) : (
                <button onClick={() => setLinkingId(linkingId === a.id ? null : a.id)} className="text-xs text-violet-600 hover:text-violet-800">
                  Link to gradebook
                </button>
              )}
              <button onClick={() => onDelete(a.id)} className="text-xs text-red-400 hover:text-red-600">Delete</button>
            </div>
          </div>
          {linkingId === a.id && (
            <RetrofitLinkForm
              homework={a} subjects={subjects} classes={classes} terms={terms}
              onDone={(assessmentId) => { onLinked(a.id, assessmentId); setLinkingId(null); }}
              onCancel={() => setLinkingId(null)}
            />
          )}
        </Fragment>
      ))}
    </div>
  );
}

function RetrofitLinkForm({
  homework, subjects, classes, terms, onDone, onCancel,
}: {
  homework: Assignment;
  subjects: SubjectOption[];
  classes: ClassOption[];
  terms: TermOption[];
  onDone: (assessmentId: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(homework.title);
  const [subjectId, setSubjectId] = useState(homework.subject_id ?? '');
  const [classId, setClassId] = useState(homework.class_id);
  const [termId, setTermId] = useState(inferTermId(homework.due_date, terms));
  const [maxMarks, setMaxMarks] = useState(homework.max_score ? String(homework.max_score) : '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<LinkPreview | null>(null);

  async function submit(confirmed: boolean) {
    if (!homework.max_score) {
      setError('Set a max score on this homework (via "Grade submissions") before linking it.');
      return;
    }
    if (!subjectId || !classId || !termId || !maxMarks) {
      setError('Fill in all fields.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const res = await apiFetch<LinkPreview | { id: string }>(`/homework/${homework.id}/link-to-gradebook`, {
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
          <div role="dialog" aria-modal="true" aria-labelledby="rollup-title"
            className="w-full max-w-md rounded-xl bg-white shadow-xl p-6 space-y-3" onClick={(e) => e.stopPropagation()}>
            <h3 id="rollup-title" className="text-lg font-semibold">
              {preview.kind === 'recompute' ? 'Recompute existing grades?' : 'Create gradebook entries?'}
            </h3>
            <p className="text-sm text-slate-600">
              {preview.kind === 'recompute'
                ? `Changing the max marks will recompute existing gradebook entries. This will affect ${preview.gradedCount} student${preview.gradedCount === 1 ? '' : 's'}.`
                : `This will create gradebook entries for the ${preview.gradedCount} student${preview.gradedCount === 1 ? '' : 's'} who have been graded. ${preview.ungradedCount} student${preview.ungradedCount === 1 ? '' : 's'} without grades won't get an entry until graded.`}
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
