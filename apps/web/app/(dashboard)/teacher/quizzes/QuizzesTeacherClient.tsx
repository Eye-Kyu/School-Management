'use client';

import { useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { getCurrentUserRow } from '@/lib/supabase/currentUser';

type Quiz = {
  id: string; title: string; is_published: boolean; time_limit_mins: number | null;
  class: { name: string } | null; subject: { name: string } | null;
};

export default function QuizzesTeacherClient({
  quizzes: initial, classes, subjects, terms,
}: {
  quizzes: Quiz[];
  classes: { id: string; name: string }[];
  subjects: { id: string; name: string }[];
  terms: { id: string; name: string; is_current: boolean }[];
}) {
  const supabase = createClient();
  const [quizzes, setQuizzes] = useState(initial);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [classId, setClassId] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [termId, setTermId] = useState(terms.find((t) => t.is_current)?.id ?? '');
  const [timeLimit, setTimeLimit] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const userRow = await getCurrentUserRow('id, school_id');
    const { data, error } = await supabase.from('quizzes').insert({
      school_id: userRow?.school_id,
      class_id: classId,
      subject_id: subjectId || null,
      term_id: termId || null,
      created_by_id: userRow?.id,
      title: title.trim(),
      time_limit_mins: timeLimit ? parseInt(timeLimit) : null,
    }).select('id, title, is_published, time_limit_mins, class:classes(name), subject:subjects(name)').single();

    if (error) { alert(`Failed to create quiz: ${error.message}`); setSaving(false); return; }
    if (data) {
      setQuizzes((p) => [data as any, ...p]);
      setShowForm(false);
      setTitle(''); setClassId(''); setSubjectId(''); setTimeLimit('');
    }
    setSaving(false);
  }

  async function togglePublish(id: string, current: boolean) {
    await supabase.from('quizzes').update({ is_published: !current }).eq('id', id);
    setQuizzes((p) => p.map((q) => q.id === id ? { ...q, is_published: !current } : q));
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
            <div key={q.id} className="flex items-center gap-4 bg-white border border-slate-100 rounded-xl px-5 py-3">
              <div className="flex-1 min-w-0">
                <p className="font-medium text-slate-800 truncate">{q.title}</p>
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
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
