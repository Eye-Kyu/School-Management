'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { CreateSubjectInput } from '@school-manager/types';

type SubjectRow = { id: string; name: string; code: string };

export default function SubjectsClient({ initialSubjects }: { initialSubjects: SubjectRow[] }) {
  const router = useRouter();
  const [subjects, setSubjects] = useState(initialSubjects);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const result = CreateSubjectInput.safeParse({ name, code: code.toUpperCase() });
    if (!result.success) { setError(result.error.issues[0]?.message ?? 'Invalid'); return; }

    setLoading(true);
    try {
      const created = await apiFetch<SubjectRow>('/subjects', {
        method: 'POST',
        body: JSON.stringify(result.data),
      });
      setSubjects((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
      setShowForm(false); setName(''); setCode('');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally { setLoading(false); }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this subject? Existing timetable slots will be removed.')) return;
    try {
      await apiFetch(`/subjects/${id}`, { method: 'DELETE' });
      setSubjects((prev) => prev.filter((s) => s.id !== id));
      router.refresh();
    } catch (err) { alert(err instanceof Error ? err.message : 'Failed'); }
  }

  return (
    <div className="space-y-4">
      <button onClick={() => setShowForm((v) => !v)}
        className="bg-slate-900 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-slate-700">
        {showForm ? 'Cancel' : '+ Add subject'}
      </button>

      {showForm && (
        <form onSubmit={handleCreate} className="bg-white border border-slate-200 rounded-lg p-5 space-y-4 max-w-md">
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700">Name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="Mathematics"
                className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700">Code</label>
              <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} required placeholder="MATH"
                className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm uppercase" />
            </div>
          </div>
          <button type="submit" disabled={loading}
            className="bg-slate-900 text-white px-4 py-2 rounded-md text-sm disabled:opacity-50">
            {loading ? 'Creating…' : 'Create subject'}
          </button>
        </form>
      )}

      {subjects.length === 0 ? (
        <p className="text-sm text-slate-500">No subjects yet.</p>
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg divide-y divide-slate-100">
          {subjects.map((s) => (
            <div key={s.id} className="flex items-center justify-between px-5 py-3">
              <div>
                <p className="font-medium text-sm">{s.name}</p>
                <p className="text-xs text-slate-500 font-mono">{s.code}</p>
              </div>
              <button onClick={() => handleDelete(s.id)}
                className="text-xs text-slate-400 hover:text-red-600 transition-colors">Delete</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
