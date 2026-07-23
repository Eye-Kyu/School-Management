'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { CreateDepartmentInput } from '@school-manager/types';

type DepartmentRow = { id: string; name: string; description: string | null; teacher_count: number };

export default function DepartmentsClient({ initialDepartments }: { initialDepartments: DepartmentRow[] }) {
  const router = useRouter();
  const [departments, setDepartments] = useState(initialDepartments);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const result = CreateDepartmentInput.safeParse({ name, description: description || undefined });
    if (!result.success) { setError(result.error.issues[0]?.message ?? 'Invalid'); return; }

    setLoading(true);
    try {
      const created = await apiFetch<{ id: string; name: string; description: string | null }>('/departments', {
        method: 'POST',
        body: JSON.stringify(result.data),
      });
      setDepartments((prev) => [...prev, { ...created, teacher_count: 0 }].sort((a, b) => a.name.localeCompare(b.name)));
      setShowForm(false); setName(''); setDescription('');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally { setLoading(false); }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this department? Teachers assigned to it will become unassigned.')) return;
    try {
      await apiFetch(`/departments/${id}`, { method: 'DELETE' });
      setDepartments((prev) => prev.filter((d) => d.id !== id));
      router.refresh();
    } catch (err) { alert(err instanceof Error ? err.message : 'Failed'); }
  }

  return (
    <div className="space-y-4">
      <button onClick={() => setShowForm((v) => !v)}
        className="bg-slate-900 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-slate-700">
        {showForm ? 'Cancel' : '+ Add department'}
      </button>

      {showForm && (
        <form onSubmit={handleCreate} className="bg-white border border-slate-200 rounded-lg p-5 space-y-4 max-w-md">
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div>
            <label className="block text-sm font-medium text-slate-700">Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="Mathematics"
              className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700">Description (optional)</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2}
              className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm resize-none" />
          </div>
          <button type="submit" disabled={loading}
            className="bg-slate-900 text-white px-4 py-2 rounded-md text-sm disabled:opacity-50">
            {loading ? 'Creating…' : 'Create department'}
          </button>
        </form>
      )}

      {departments.length === 0 ? (
        <p className="text-sm text-slate-500">No departments yet.</p>
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg divide-y divide-slate-100">
          {departments.map((d) => (
            <div key={d.id} className="flex items-center justify-between px-5 py-3">
              <div>
                <p className="font-medium text-sm">{d.name}</p>
                <p className="text-xs text-slate-500">
                  {d.teacher_count} teacher{d.teacher_count !== 1 ? 's' : ''}
                  {d.description ? ` · ${d.description}` : ''}
                </p>
              </div>
              <button onClick={() => handleDelete(d.id)}
                className="text-xs text-slate-400 hover:text-red-600 transition-colors">Delete</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
