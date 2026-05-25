'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { CreateTeacherInput } from '@school-manager/types';

type TeacherRow = {
  id: string;
  staff_no: string;
  department: string | null;
  user: { id: string; full_name: string; email: string | null; phone: string | null; is_active: boolean };
};

export default function TeachersClient({ initialTeachers }: { initialTeachers: TeacherRow[] }) {
  const router = useRouter();
  const [teachers, setTeachers] = useState(initialTeachers);
  const [showForm, setShowForm] = useState(false);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [staffNo, setStaffNo] = useState('');
  const [department, setDepartment] = useState('');
  const [tempPassword, setTempPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const result = CreateTeacherInput.safeParse({
      fullName,
      email: email || undefined,
      phone: phone || undefined,
      staffNo,
      department: department || undefined,
    });
    if (!result.success) { setError(result.error.issues[0]?.message ?? 'Invalid'); return; }

    setLoading(true);
    try {
      const created = await apiFetch<TeacherRow & { temporaryPassword: string }>('/teachers', {
        method: 'POST',
        body: JSON.stringify(result.data),
      });
      setTempPassword(created.temporaryPassword);
      setTeachers((prev) => [...prev, created]);
      setShowForm(false);
      setFullName(''); setEmail(''); setPhone(''); setStaffNo(''); setDepartment('');
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

      <button onClick={() => setShowForm((v) => !v)}
        className="bg-slate-900 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-slate-700">
        {showForm ? 'Cancel' : '+ Add teacher'}
      </button>

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
              <input value={department} onChange={(e) => setDepartment(e.target.value)} placeholder="e.g. Mathematics"
                className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
            </div>
          </div>
          <button type="submit" disabled={loading}
            className="bg-slate-900 text-white px-4 py-2 rounded-md text-sm disabled:opacity-50">
            {loading ? 'Creating…' : 'Create teacher'}
          </button>
        </form>
      )}

      {teachers.length === 0 ? (
        <p className="text-sm text-slate-500">No teachers yet.</p>
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg divide-y divide-slate-100">
          {teachers.map((t) => (
            <div key={t.id} className="flex items-center justify-between px-5 py-3">
              <div>
                <p className="font-medium text-sm">{t.user.full_name}</p>
                <p className="text-xs text-slate-500">
                  {t.staff_no}{t.department ? ` · ${t.department}` : ''} · {t.user.email ?? t.user.phone}
                </p>
              </div>
              <button onClick={() => handleDeactivate(t.id)}
                className="text-xs text-slate-400 hover:text-red-600 transition-colors">Deactivate</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
