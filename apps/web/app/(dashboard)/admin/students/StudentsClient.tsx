'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { CreateStudentInput } from '@school-manager/types';

type StudentRow = {
  id: string;
  admission_no: string;
  user: { full_name: string; email: string | null; phone: string | null };
  class: { id: string; name: string } | null;
};
type ClassOption = { id: string; name: string; grade_level: number };

export default function StudentsClient({
  initialStudents,
  classes,
}: {
  initialStudents: StudentRow[];
  classes: ClassOption[];
}) {
  const router = useRouter();
  const [students, setStudents] = useState(initialStudents);
  const [showForm, setShowForm] = useState(false);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [admissionNo, setAdmissionNo] = useState('');
  const [classId, setClassId] = useState('');
  const [gender, setGender] = useState('');
  const [tempPassword, setTempPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const result = CreateStudentInput.safeParse({
      fullName,
      email: email || undefined,
      phone: phone || undefined,
      admissionNo,
      classId: classId || undefined,
      gender: (gender as 'MALE' | 'FEMALE' | 'OTHER') || undefined,
    });
    if (!result.success) { setError(result.error.issues[0]?.message ?? 'Invalid'); return; }

    setLoading(true);
    try {
      const created = await apiFetch<StudentRow & { temporaryPassword: string }>('/students', {
        method: 'POST',
        body: JSON.stringify(result.data),
      });
      setTempPassword(created.temporaryPassword);
      setStudents((prev) => [...prev, created]);
      setShowForm(false);
      setFullName(''); setEmail(''); setPhone(''); setAdmissionNo(''); setClassId(''); setGender('');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally { setLoading(false); }
  }

  async function handleDeactivate(id: string) {
    if (!confirm('Remove this student from the school?')) return;
    try {
      await apiFetch(`/students/${id}`, { method: 'DELETE' });
      setStudents((prev) => prev.filter((s) => s.id !== id));
      router.refresh();
    } catch (err) { alert(err instanceof Error ? err.message : 'Failed'); }
  }

  return (
    <div className="space-y-4">
      {tempPassword && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm">
          <p className="font-medium text-amber-800">Student enrolled — temporary password:</p>
          <p className="mt-1 font-mono text-amber-700">{tempPassword}</p>
          <button onClick={() => setTempPassword('')} className="mt-2 text-xs text-amber-500 underline">Dismiss</button>
        </div>
      )}

      <button onClick={() => setShowForm((v) => !v)}
        className="bg-slate-900 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-slate-700">
        {showForm ? 'Cancel' : '+ Enrol student'}
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
              <label className="block text-sm font-medium text-slate-700">Admission no.</label>
              <input value={admissionNo} onChange={(e) => setAdmissionNo(e.target.value)} required
                className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700">Gender</label>
              <select value={gender} onChange={(e) => setGender(e.target.value)}
                className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm">
                <option value="">—</option>
                <option value="MALE">Male</option>
                <option value="FEMALE">Female</option>
                <option value="OTHER">Other</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700">Class</label>
            <select value={classId} onChange={(e) => setClassId(e.target.value)}
              className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm">
              <option value="">— Assign later —</option>
              {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <button type="submit" disabled={loading}
            className="bg-slate-900 text-white px-4 py-2 rounded-md text-sm disabled:opacity-50">
            {loading ? 'Enrolling…' : 'Enrol student'}
          </button>
        </form>
      )}

      {students.length === 0 ? (
        <p className="text-sm text-slate-500">No students enrolled yet.</p>
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg divide-y divide-slate-100">
          {students.map((s) => (
            <div key={s.id} className="flex items-center justify-between px-5 py-3">
              <div>
                <p className="font-medium text-sm">{s.user.full_name}</p>
                <p className="text-xs text-slate-500">
                  {s.admission_no}{s.class ? ` · ${s.class.name}` : ''}
                </p>
              </div>
              <button onClick={() => handleDeactivate(s.id)}
                className="text-xs text-slate-400 hover:text-red-600 transition-colors">Remove</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
