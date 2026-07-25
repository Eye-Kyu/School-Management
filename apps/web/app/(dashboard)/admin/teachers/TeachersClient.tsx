'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { CreateTeacherInput } from '@school-manager/types';
import { Badge } from '@school-manager/ui';

type Department = { id: string; name: string };
type TeacherRow = {
  id: string;
  staff_no: string;
  department_id: string | null;
  department_row: Department | null;
  user: { id: string; full_name: string; email: string | null; phone: string | null; is_active: boolean };
  headOfDepartment?: string | null;
};

export default function TeachersClient({
  initialTeachers,
  departments,
}: {
  initialTeachers: TeacherRow[];
  departments: Department[];
}) {
  const router = useRouter();
  const [teachers, setTeachers] = useState(initialTeachers);
  const [showForm, setShowForm] = useState(false);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [staffNo, setStaffNo] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [tempPassword, setTempPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [filterDept, setFilterDept] = useState('');

  const visibleTeachers = filterDept
    ? teachers.filter((t) => (filterDept === '__none__' ? !t.department_id : t.department_id === filterDept))
    : teachers;

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const result = CreateTeacherInput.safeParse({
      fullName,
      email: email || undefined,
      phone: phone || undefined,
      staffNo,
      departmentId: departmentId || undefined,
    });
    if (!result.success) { setError(result.error.issues[0]?.message ?? 'Invalid'); return; }

    setLoading(true);
    try {
      const created = await apiFetch<TeacherRow & { temporaryPassword: string }>('/teachers', {
        method: 'POST',
        body: JSON.stringify(result.data),
      });
      setTempPassword(created.temporaryPassword);
      setTeachers((prev) => [...prev, {
        ...created,
        department_row: departments.find((d) => d.id === departmentId) ?? null,
      }]);
      setShowForm(false);
      setFullName(''); setEmail(''); setPhone(''); setStaffNo(''); setDepartmentId('');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally { setLoading(false); }
  }

  async function handleDeactivate(id: string) {
    if (!confirm('Deactivate this teacher?')) return;
    try {
      await apiFetch(`/teachers/${id}`, { method: 'DELETE' });
      setTeachers((prev) => prev.filter((t) => t.id !== id));
      router.refresh();
    } catch (err) { alert(err instanceof Error ? err.message : 'Failed'); }
  }

  async function handleReassign(teacherId: string, newDepartmentId: string) {
    const prev = teachers;
    setTeachers((p) => p.map((t) => t.id === teacherId
      ? { ...t, department_id: newDepartmentId || null, department_row: departments.find((d) => d.id === newDepartmentId) ?? null }
      : t));
    try {
      await apiFetch(`/teachers/${teacherId}`, {
        method: 'PATCH',
        body: JSON.stringify({ departmentId: newDepartmentId || null }),
      });
      router.refresh();
    } catch (err) {
      setTeachers(prev); // revert on failure
      alert(err instanceof Error ? err.message : 'Failed to reassign department');
    }
  }

  return (
    <div className="space-y-4">
      {tempPassword && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm">
          <p className="font-medium text-amber-800">Teacher created — share these credentials:</p>
          <p className="mt-1 text-amber-700 font-mono">Temporary password: {tempPassword}</p>
          <p className="text-xs text-amber-600 mt-1">The teacher must change this on first login.</p>
          <button onClick={() => setTempPassword('')} className="mt-2 text-xs text-amber-500 underline">Dismiss</button>
        </div>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <button onClick={() => setShowForm((v) => !v)}
          className="bg-slate-900 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-slate-700">
          {showForm ? 'Cancel' : '+ Add teacher'}
        </button>

        {departments.length > 0 && (
          <label className="text-sm text-slate-600 flex items-center gap-2">
            Filter by department
            <select value={filterDept} onChange={(e) => setFilterDept(e.target.value)}
              className="rounded-md border border-slate-300 px-2 py-1.5 text-sm">
              <option value="">All</option>
              <option value="__none__">Unassigned</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </label>
        )}
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="bg-white border border-slate-200 rounded-lg p-5 space-y-4 max-w-md">
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div>
            <label className="block text-sm font-medium text-slate-700">Full name</label>
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} required
              className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700">Email</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700">Phone</label>
              <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+254..."
                className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700">Staff number</label>
              <input value={staffNo} onChange={(e) => setStaffNo(e.target.value)} required
                className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700">Department</label>
              <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}
                className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm">
                <option value="">None</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>
          </div>
          <button type="submit" disabled={loading}
            className="bg-slate-900 text-white px-4 py-2 rounded-md text-sm disabled:opacity-50">
            {loading ? 'Creating…' : 'Create teacher'}
          </button>
        </form>
      )}

      {visibleTeachers.length === 0 ? (
        <p className="text-sm text-slate-500">No teachers yet.</p>
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg divide-y divide-slate-100">
          {visibleTeachers.map((t) => (
            <div key={t.id} className="flex items-center justify-between px-5 py-3 gap-3">
              <div className="min-w-0">
                <p className="font-medium text-sm flex items-center gap-2">
                  {t.user.full_name}
                  {t.headOfDepartment && (
                    <Badge variant="departmentHead">Head of {t.headOfDepartment}</Badge>
                  )}
                </p>
                <p className="text-xs text-slate-500">
                  {t.staff_no} · {t.user.email ?? t.user.phone}
                </p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <select
                  value={t.department_id ?? ''}
                  onChange={(e) => handleReassign(t.id, e.target.value)}
                  className="text-xs rounded-md border border-slate-300 px-2 py-1"
                  aria-label={`Department for ${t.user.full_name}`}
                >
                  <option value="">No department</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
                <button onClick={() => handleDeactivate(t.id)}
                  className="text-xs text-slate-400 hover:text-red-600 transition-colors">Deactivate</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
