'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { CreateParentInput } from '@school-manager/types';

type Child = { admissionNo: string; studentName: string; relationship: string };
type Parent = { userId: string; fullName: string; email: string | null; phone: string | null; children: Child[] };

interface Props {
  initialParents: Parent[];
  students: { id: string; admission_no: string; user: { full_name: string } }[];
}

export default function ParentsClient({ initialParents, students }: Props) {
  const router = useRouter();
  const [parents, setParents] = useState(initialParents);
  const [showForm, setShowForm] = useState(false);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [admissionNos, setAdmissionNos] = useState('');
  const [relationship, setRelationship] = useState<'MOTHER' | 'FATHER' | 'GUARDIAN' | 'OTHER'>('GUARDIAN');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tempPassword, setTempPassword] = useState<string | null>(null);

  async function handleCreate() {
    setError(null);
    const childAdmissionNos = admissionNos.split(',').map(s => s.trim()).filter(Boolean);
    const parsed = CreateParentInput.safeParse({
      fullName,
      email: email || undefined,
      phone: phone || undefined,
      childAdmissionNos,
      relationship,
    });
    if (!parsed.success) {
      setError(parsed.error.errors[0]?.message ?? 'Validation error');
      return;
    }
    setLoading(true);
    try {
      const res = await apiFetch<{ userId: string; temporaryPassword: string }>('/guardians', {
        method: 'POST',
        body: JSON.stringify(parsed.data),
      });
      setTempPassword(res.temporaryPassword);
      setFullName(''); setEmail(''); setPhone(''); setAdmissionNos('');
      setRelationship('GUARDIAN');
      setShowForm(false);
      router.refresh();
    } catch (e: any) {
      setError(e.message ?? 'Failed to create parent');
    } finally {
      setLoading(false);
    }
  }

  async function handleRemove(userId: string, name: string) {
    if (!confirm(`Remove ${name}? They will no longer be able to log in.`)) return;
    try {
      await apiFetch(`/guardians/${userId}`, { method: 'DELETE' });
      setParents(prev => prev.filter(p => p.userId !== userId));
    } catch (e: any) {
      alert(e.message ?? 'Failed to remove parent');
    }
  }

  return (
    <div className="space-y-4">
      {tempPassword && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-4">
          <p className="text-sm font-medium text-amber-800">Parent created successfully!</p>
          <p className="text-sm text-amber-700 mt-1">
            Temporary password: <span className="font-mono font-bold">{tempPassword}</span>
          </p>
          <p className="text-xs text-amber-600 mt-1">Share this with the parent. They should change it after first login.</p>
          <button onClick={() => setTempPassword(null)} className="text-xs text-amber-500 underline mt-2">Dismiss</button>
        </div>
      )}

      <div className="flex justify-end">
        <button
          onClick={() => { setShowForm(v => !v); setError(null); }}
          className="px-4 py-2 text-sm bg-pink-600 hover:bg-pink-700 text-white rounded-lg font-medium transition-colors"
        >
          {showForm ? 'Cancel' : '+ Add parent'}
        </button>
      </div>

      {showForm && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <h3 className="text-sm font-semibold text-slate-700">New parent account</h3>

          {error && (
            <div className="text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-4 py-3">{error}</div>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Full name *</label>
            <input
              value={fullName}
              onChange={e => setFullName(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pink-500"
              placeholder="Jane Kamau"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pink-500"
                placeholder="jane@example.com"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Phone</label>
              <input
                type="tel"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pink-500"
                placeholder="+254700000000"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Child admission numbers * <span className="text-slate-400 font-normal">(comma-separated)</span>
              </label>
              <input
                value={admissionNos}
                onChange={e => setAdmissionNos(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pink-500"
                placeholder="ADM001, ADM002"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Relationship</label>
              <select
                value={relationship}
                onChange={e => setRelationship(e.target.value as any)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pink-500"
              >
                <option value="MOTHER">Mother</option>
                <option value="FATHER">Father</option>
                <option value="GUARDIAN">Guardian</option>
                <option value="OTHER">Other</option>
              </select>
            </div>
          </div>

          {students.length > 0 && (
            <p className="text-xs text-slate-400">
              Enrolled students: {students.map(s => `${s.admission_no} — ${(s.user as any).full_name}`).join(', ')}
            </p>
          )}

          <button
            onClick={handleCreate}
            disabled={loading}
            className="w-full bg-pink-600 hover:bg-pink-700 disabled:opacity-50 text-white text-sm font-medium py-2 rounded-lg transition-colors"
          >
            {loading ? 'Creating…' : 'Create parent account'}
          </button>
        </div>
      )}

      {parents.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl px-5 py-10 text-center text-sm text-slate-400">
          No parent accounts yet. Add the first parent above.
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">Parent</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">Contact</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">Children</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {parents.map(p => (
                <tr key={p.userId} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3 font-medium text-slate-800">{p.fullName}</td>
                  <td className="px-4 py-3 text-slate-500 text-xs">
                    {p.email && <div>{p.email}</div>}
                    {p.phone && <div>{p.phone}</div>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {p.children.map((c, i) => (
                        <span key={i} className="text-xs bg-pink-50 text-pink-700 border border-pink-100 rounded-full px-2 py-0.5">
                          {c.studentName} <span className="text-pink-400">({c.admissionNo})</span>
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => handleRemove(p.userId, p.fullName)}
                      className="text-xs text-rose-500 hover:text-rose-700 transition-colors"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
