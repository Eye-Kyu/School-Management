'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { CreateDepartmentInput } from '@school-manager/types';

type DepartmentRow = {
  id: string; name: string; description: string | null; teacher_count: number;
  department_head_user_id: string | null; head_name: string | null;
};
type TeacherOption = { userId: string; departmentId: string | null; fullName: string };

export default function DepartmentsClient({ initialDepartments, teachers }: { initialDepartments: DepartmentRow[]; teachers: TeacherOption[] }) {
  const router = useRouter();
  const [departments, setDepartments] = useState(initialDepartments);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [savingHeadFor, setSavingHeadFor] = useState<string | null>(null);

  async function handleSetHead(department: DepartmentRow, teacherUserId: string) {
    setSavingHeadFor(department.id);
    setError('');
    const value = teacherUserId || null;
    try {
      await apiFetch(`/departments/${department.id}/head`, { method: 'PATCH', body: JSON.stringify({ teacherUserId: value }) });
      const headName = value ? teachers.find((t) => t.userId === value)?.fullName ?? null : null;
      setDepartments((prev) => prev.map((d) => (d.id === department.id ? { ...d, department_head_user_id: value, head_name: headName } : d)));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to set department head');
    } finally {
      setSavingHeadFor(null);
    }
  }

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
      setDepartments((prev) => [...prev, { ...created, teacher_count: 0, department_head_user_id: null, head_name: null }].sort((a, b) => a.name.localeCompare(b.name)));
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
          {departments.map((d) => {
            const eligibleTeachers = teachers.filter((t) => t.departmentId === d.id);
            return (
              <div key={d.id} className="flex items-center justify-between px-5 py-3 gap-4">
                <div className="min-w-0">
                  <p className="font-medium text-sm">{d.name}</p>
                  <p className="text-xs text-slate-500">
                    {d.teacher_count} teacher{d.teacher_count !== 1 ? 's' : ''}
                    {d.description ? ` · ${d.description}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <div className="flex items-center gap-1.5">
                    <label className="text-xs text-slate-500">Head:</label>
                    <select
                      value={d.department_head_user_id ?? ''}
                      onChange={(e) => handleSetHead(d, e.target.value)}
                      disabled={savingHeadFor === d.id}
                      className="text-xs rounded-md border border-slate-300 px-2 py-1 disabled:opacity-50"
                    >
                      <option value="">None</option>
                      {eligibleTeachers.map((t) => (
                        <option key={t.userId} value={t.userId}>{t.fullName}</option>
                      ))}
                    </select>
                  </div>
                  <button onClick={() => handleDelete(d.id)}
                    className="text-xs text-slate-400 hover:text-red-600 transition-colors">Delete</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
