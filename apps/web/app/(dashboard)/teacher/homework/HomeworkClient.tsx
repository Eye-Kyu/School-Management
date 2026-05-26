'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';

type Assignment = {
  id: string;
  title: string;
  description: string | null;
  due_date: string;
  class_id: string;
  subject_id: string | null;
  class: { name: string } | null;
  subject: { name: string } | null;
};

type ClassOption = { id: string; name: string };
type SubjectOption = { id: string; name: string };

function isOverdue(dueDate: string) {
  return new Date(dueDate) < new Date(new Date().toDateString());
}

export default function HomeworkClient({
  assignments: initial,
  classes,
  subjects,
}: {
  assignments: Assignment[];
  classes: ClassOption[];
  subjects: SubjectOption[];
}) {
  const router = useRouter();
  const [assignments, setAssignments] = useState(initial);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [classId, setClassId] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function openForm() {
    setTitle(''); setDescription(''); setClassId(classes[0]?.id ?? '');
    setSubjectId(''); setDueDate(''); setError('');
    setShowForm(true);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const created = await apiFetch<Assignment>('/homework', {
        method: 'POST',
        body: JSON.stringify({
          classId, subjectId: subjectId || undefined,
          title, description: description || undefined, dueDate,
        }),
      });
      setAssignments((prev) => [...prev, created].sort((a, b) => a.due_date.localeCompare(b.due_date)));
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
          <AssignmentList items={upcoming} onDelete={handleDelete} />
        </section>
      )}

      {past.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide">Past</h2>
          <AssignmentList items={past} onDelete={handleDelete} />
        </section>
      )}

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white shadow-xl p-6 space-y-4">
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
              <div>
                <label className="block text-sm font-medium text-slate-700">Due date</label>
                <input
                  required type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)}
                  className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
                />
              </div>
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

function AssignmentList({ items, onDelete }: { items: Assignment[]; onDelete: (id: string) => void }) {
  return (
    <div className="space-y-2">
      {items.map((a) => (
        <div key={a.id} className="flex items-start justify-between rounded-lg border border-slate-200 bg-white px-4 py-3">
          <div className="space-y-0.5 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium text-slate-800 text-sm">{a.title}</span>
              {a.subject && (
                <span className="text-xs bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">{a.subject.name}</span>
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
          <button onClick={() => onDelete(a.id)} className="ml-3 shrink-0 text-xs text-red-400 hover:text-red-600">Delete</button>
        </div>
      ))}
    </div>
  );
}
