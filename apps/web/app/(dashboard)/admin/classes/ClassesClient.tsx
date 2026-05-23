'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { CreateClassInput } from '@school-manager/types';

type ClassRow = { id: string; name: string; grade_level: number; stream: string | null };

export default function ClassesClient({ initialClasses }: { initialClasses: ClassRow[] }) {
  const router = useRouter();
  const [classes, setClasses] = useState(initialClasses);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [gradeLevel, setGradeLevel] = useState('');
  const [stream, setStream] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    const result = CreateClassInput.safeParse({
      name,
      gradeLevel: Number(gradeLevel),
      stream: stream || undefined,
    });
    if (!result.success) { setError(result.error.issues[0]?.message ?? 'Invalid input'); return; }

    setLoading(true);
    try {
      const created = await apiFetch<ClassRow>('/classes', {
        method: 'POST',
        body: JSON.stringify(result.data),
      });
      setClasses((prev) => [...prev, created].sort((a, b) => a.grade_level - b.grade_level || a.name.localeCompare(b.name)));
      setShowForm(false);
      setName(''); setGradeLevel(''); setStream('');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create class');
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Archive this class? Students will remain but the class will be hidden.')) return;
    try {
      await apiFetch(`/classes/${id}`, { method: 'DELETE' });
      setClasses((prev) => prev.filter((c) => c.id !== id));
      router.refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete');
    }
  }

  return (
    <div className="space-y-4">
      <button
        onClick={() => setShowForm((v) => !v)}
        className="bg-slate-900 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-slate-700"
      >
        {showForm ? 'Cancel' : '+ Add class'}
      </button>

      {showForm && (
        <form onSubmit={handleCreate} className="bg-white border border-slate-200 rounded-lg p-5 space-y-4 max-w-md">
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div>
            <label className="block text-sm font-medium text-slate-700">Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="Grade 5 Blue"
              className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700">Grade level</label>
              <input type="number" min={0} max={20} value={gradeLevel} onChange={(e) => setGradeLevel(e.target.value)} required
                className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700">Stream (optional)</label>
              <input value={stream} onChange={(e) => setStream(e.target.value)} placeholder="Blue"
                className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
            </div>
          </div>
          <button type="submit" disabled={loading}
            className="bg-slate-900 text-white px-4 py-2 rounded-md text-sm disabled:opacity-50">
            {loading ? 'Creating…' : 'Create class'}
          </button>
        </form>
      )}

      {classes.length === 0 ? (
        <p className="text-sm text-slate-500">No classes yet. Add your first class above.</p>
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg divide-y divide-slate-100">
          {classes.map((c) => (
            <div key={c.id} className="flex items-center justify-between px-5 py-3">
              <div>
                <p className="font-medium text-sm">{c.name}</p>
                <p className="text-xs text-slate-500">Grade {c.grade_level}{c.stream ? ` · ${c.stream}` : ''}</p>
              </div>
              <button onClick={() => handleDelete(c.id)}
                className="text-xs text-slate-400 hover:text-red-600 transition-colors">
                Archive
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
