'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { getCurrentUserRow } from '@/lib/supabase/currentUser';

type Assignment = {
  id: string; title: string; description: string | null; due_date: string;
  class: { name: string } | null; subject: { name: string } | null; term: { name: string } | null;
};

export default function AssignmentsTeacherClient({
  assignments: initial, classes, subjects, terms, teacherUserId,
}: {
  assignments: Assignment[];
  classes: { id: string; name: string }[];
  subjects: { id: string; name: string }[];
  terms: { id: string; name: string; is_current: boolean }[];
  teacherUserId: string;
}) {
  const router = useRouter();
  const supabase = createClient();

  const [assignments, setAssignments] = useState(initial);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [classId, setClassId] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [termId, setTermId] = useState(terms.find((t) => t.is_current)?.id ?? '');
  const [dueDate, setDueDate] = useState('');
  const [maxScore, setMaxScore] = useState('100');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setErr('');
    const userRow = await getCurrentUserRow('id, school_id');
    const { data, error } = await supabase.from('assignments').insert({
      school_id: userRow?.school_id,
      class_id: classId,
      subject_id: subjectId || null,
      term_id: termId || null,
      created_by_id: userRow?.id,
      title: title.trim(),
      description: desc.trim() || null,
      due_date: dueDate,
      max_score: parseFloat(maxScore) || null,
    }).select('id, title, description, due_date, created_at, class:classes(name), subject:subjects(name), term:terms(name)').single();

    if (error) { setErr(error.message); setSaving(false); return; }
    setAssignments((p) => [...p, data as any]);
    setShowForm(false);
    setTitle(''); setDesc(''); setClassId(''); setSubjectId(''); setDueDate('');
    setSaving(false);
    router.refresh();
  }

  function dueBadge(due: string) {
    const diff = new Date(due).getTime() - Date.now();
    const days = Math.ceil(diff / 86400000);
    if (days < 0) return <span className="text-xs text-rose-600 font-medium">Overdue</span>;
    if (days === 0) return <span className="text-xs text-amber-600 font-medium">Due today</span>;
    if (days <= 3) return <span className="text-xs text-amber-500 font-medium">Due in {days}d</span>;
    return <span className="text-xs text-slate-400">{new Date(due).toLocaleDateString('en-KE', { day: 'numeric', month: 'short' })}</span>;
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={() => setShowForm((v) => !v)}
          className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-700 transition-colors">
          {showForm ? 'Cancel' : '+ New assignment'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <h2 className="font-semibold text-slate-800">New assignment</h2>
          {err && <p className="text-sm text-red-600">{err}</p>}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Title</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Instructions (optional)</label>
            <textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={3} maxLength={5000}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm resize-none" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Class</label>
              <select value={classId} onChange={(e) => setClassId(e.target.value)} required
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm">
                <option value="">Select class…</option>
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
              <label className="block text-sm font-medium text-slate-700 mb-1">Due date</label>
              <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} required
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Max score (optional)</label>
              <input type="number" min="1" value={maxScore} onChange={(e) => setMaxScore(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowForm(false)}
              className="px-4 py-2 rounded-lg text-sm text-slate-600 hover:bg-slate-100">Cancel</button>
            <button type="submit" disabled={saving}
              className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-700 disabled:opacity-50">
              {saving ? 'Creating…' : 'Create assignment'}
            </button>
          </div>
        </form>
      )}

      {assignments.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-white p-10 text-center text-sm text-slate-400">
          No assignments yet. Create one above.
        </div>
      ) : (
        <div className="space-y-2">
          {assignments.map((a) => (
            <Link key={a.id} href={`/teacher/assignments/${a.id}`}
              className="flex items-center gap-4 bg-white border border-slate-100 rounded-xl px-5 py-3 hover:shadow-sm transition-shadow">
              <div className="flex-1 min-w-0">
                <p className="font-medium text-slate-800 truncate">{a.title}</p>
                <p className="text-xs text-slate-400 mt-0.5">
                  {(a.class as any)?.name ?? '—'}
                  {(a.subject as any)?.name ? ` · ${(a.subject as any).name}` : ''}
                  {(a.term as any)?.name ? ` · ${(a.term as any).name}` : ''}
                </p>
              </div>
              {dueBadge(a.due_date)}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
