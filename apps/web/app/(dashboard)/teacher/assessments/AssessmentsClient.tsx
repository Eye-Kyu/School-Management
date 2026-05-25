'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';

type Assessment = {
  id: string;
  name: string;
  max_marks: number;
  assessment_date: string | null;
  created_at: string;
  term: { id: string; name: string } | null;
  class: { id: string; name: string } | null;
  subject: { id: string; name: string; code: string } | null;
};

type ClassOption = { id: string; name: string };
type SubjectOption = { id: string; name: string; code: string };
type TermOption = { id: string; name: string };

export default function AssessmentsClient({
  assessments: initialAssessments,
  classes,
  classSubjectsMap,
  terms,
  currentTermId,
}: {
  assessments: Assessment[];
  classes: ClassOption[];
  classSubjectsMap: Record<string, SubjectOption[]>;
  terms: TermOption[];
  currentTermId: string | null;
}) {
  const router = useRouter();
  const [assessments, setAssessments] = useState(initialAssessments);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);

  // Form state
  const [termId, setTermId] = useState(currentTermId ?? terms[0]?.id ?? '');
  const [classId, setClassId] = useState(classes[0]?.id ?? '');
  const [subjectId, setSubjectId] = useState('');
  const [name, setName] = useState('');
  const [maxMarks, setMaxMarks] = useState('100');
  const [assessmentDate, setAssessmentDate] = useState('');

  const subjects = classId ? (classSubjectsMap[classId] ?? []) : [];

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!termId || !classId || !subjectId || !name || !maxMarks) return;
    setSaving(true);
    setError('');
    try {
      const created = await apiFetch<Assessment>('/assessments', {
        method: 'POST',
        body: JSON.stringify({
          termId,
          classId,
          subjectId,
          name: name.trim(),
          maxMarks: Number(maxMarks),
          assessmentDate: assessmentDate || undefined,
        }),
      });
      setAssessments((prev) => [created as any, ...prev]);
      setShowForm(false);
      setName('');
      setMaxMarks('100');
      setAssessmentDate('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create assessment');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this assessment and all its scores?')) return;
    setDeleting(id);
    try {
      await apiFetch(`/assessments/${id}`, { method: 'DELETE' });
      setAssessments((prev) => prev.filter((a) => a.id !== id));
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">{assessments.length} assessment{assessments.length !== 1 ? 's' : ''}</p>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="px-4 py-2 rounded-lg bg-violet-600 text-white text-sm font-medium hover:bg-violet-700 transition-colors"
        >
          {showForm ? 'Cancel' : '+ New assessment'}
        </button>
      </div>

      {/* Create form */}
      {showForm && (
        <form onSubmit={handleCreate} className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <h2 className="text-base font-semibold text-slate-800">New assessment</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {terms.length > 0 && (
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Term</label>
                <select
                  value={termId}
                  onChange={(e) => setTermId(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
                  required
                >
                  {terms.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Class</label>
              <select
                value={classId}
                onChange={(e) => { setClassId(e.target.value); setSubjectId(''); }}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
                required
              >
                <option value="">Select class…</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Subject</label>
              <select
                value={subjectId}
                onChange={(e) => setSubjectId(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
                required
                disabled={!classId || subjects.length === 0}
              >
                <option value="">Select subject…</option>
                {subjects.map((s) => (
                  <option key={s.id} value={s.id}>{s.name} ({s.code})</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Assessment name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Mid-Term Test"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
                required
                maxLength={100}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Max marks</label>
              <input
                type="number"
                value={maxMarks}
                onChange={(e) => setMaxMarks(e.target.value)}
                min={1}
                max={1000}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Date (optional)</label>
              <input
                type="date"
                value={assessmentDate}
                onChange={(e) => setAssessmentDate(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
              />
            </div>
          </div>
          {error && <p className="text-sm text-rose-600">{error}</p>}
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2 rounded-lg bg-violet-600 text-white text-sm font-medium hover:bg-violet-700 disabled:opacity-50 transition-colors"
            >
              {saving ? 'Creating…' : 'Create assessment'}
            </button>
          </div>
        </form>
      )}

      {/* Assessments list */}
      {assessments.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl px-5 py-12 text-center text-sm text-slate-400">
          No assessments yet. Create one above.
        </div>
      ) : (
        <div className="space-y-2">
          {assessments.map((a) => (
            <div
              key={a.id}
              className="bg-white border border-slate-200 rounded-xl px-5 py-4 flex items-center justify-between gap-4 shadow-sm"
            >
              <Link href={`/teacher/assessments/${a.id}`} className="flex-1 min-w-0 group">
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <span className="font-medium text-sm text-slate-800 group-hover:text-violet-700 transition-colors">
                    {a.name}
                  </span>
                  <span className="text-xs bg-violet-50 text-violet-700 rounded-full px-2 py-0.5">
                    {a.subject?.name ?? '—'} · {a.class?.name ?? '—'}
                  </span>
                  {a.term && (
                    <span className="text-xs bg-slate-100 text-slate-600 rounded-full px-2 py-0.5">
                      {a.term.name}
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-400">
                  Out of {a.max_marks}
                  {a.assessment_date ? ` · ${new Date(a.assessment_date).toLocaleDateString()}` : ''}
                </p>
              </Link>
              <div className="flex items-center gap-3 shrink-0">
                <Link
                  href={`/teacher/assessments/${a.id}`}
                  className="text-xs text-violet-600 hover:text-violet-800 font-medium"
                >
                  Enter marks →
                </Link>
                <button
                  onClick={() => handleDelete(a.id)}
                  disabled={deleting === a.id}
                  className="text-xs text-rose-400 hover:text-rose-600 disabled:opacity-40 transition-colors"
                >
                  {deleting === a.id ? '…' : 'Delete'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
