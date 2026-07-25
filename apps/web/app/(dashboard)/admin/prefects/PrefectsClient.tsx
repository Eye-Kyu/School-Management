'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';

type ClassPrefectRow = {
  id: string; class_id: string; student_id: string; term_id: string | null; assigned_at: string;
  student: { admission_no: string; user: { full_name: string } };
};
type ClassRow = { id: string; name: string; grade_level: number; prefect: ClassPrefectRow | null };
type SchoolPrefectRow = {
  id: string; student_id: string; role_title: string; term_id: string | null;
  assigned_at: string; revoked_at: string | null; revocation_reason: string | null;
  student: { admission_no: string; user: { full_name: string } };
};
type StudentOption = { id: string; admission_no: string; current_class_id: string | null; user: { full_name: string } };

export default function PrefectsClient({
  initialClassRows, initialSchoolPrefects, students,
}: {
  initialClassRows: ClassRow[]; initialSchoolPrefects: SchoolPrefectRow[]; students: StudentOption[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState<'class' | 'school'>('class');
  const [classRows, setClassRows] = useState(initialClassRows);
  const [schoolPrefects, setSchoolPrefects] = useState(initialSchoolPrefects.filter((p) => !p.revoked_at));
  const [error, setError] = useState('');

  async function revokeClassPrefect(row: ClassRow) {
    if (!row.prefect) return;
    const reason = prompt('Reason for revoking this Class Prefect?') ?? '';
    try {
      await apiFetch(`/prefects/class/${row.prefect.id}/revoke`, { method: 'POST', body: JSON.stringify({ reason: reason || undefined }) });
      setClassRows((prev) => prev.map((c) => (c.id === row.id ? { ...c, prefect: null } : c)));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke');
    }
  }

  const [showAssignForm, setShowAssignForm] = useState(false);
  const [studentQuery, setStudentQuery] = useState('');
  const [selectedStudentId, setSelectedStudentId] = useState('');
  const [roleTitle, setRoleTitle] = useState('');
  const [assigning, setAssigning] = useState(false);

  const filteredStudents = studentQuery.trim()
    ? students.filter((s) => s.user.full_name.toLowerCase().includes(studentQuery.toLowerCase()) || s.admission_no.toLowerCase().includes(studentQuery.toLowerCase()))
    : [];

  async function assignSchoolPrefect(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedStudentId || !roleTitle.trim()) return;
    setAssigning(true);
    setError('');
    try {
      const created = await apiFetch<SchoolPrefectRow>('/prefects/school', {
        method: 'POST',
        body: JSON.stringify({ studentId: selectedStudentId, roleTitle: roleTitle.trim(), termId: null }),
      });
      setSchoolPrefects((prev) => [created, ...prev]);
      setShowAssignForm(false); setStudentQuery(''); setSelectedStudentId(''); setRoleTitle('');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to assign');
    } finally {
      setAssigning(false);
    }
  }

  async function revokeSchoolPrefect(row: SchoolPrefectRow) {
    const reason = prompt(`Reason for revoking ${row.role_title}?`) ?? '';
    try {
      await apiFetch(`/prefects/school/${row.id}/revoke`, { method: 'POST', body: JSON.stringify({ reason: reason || undefined }) });
      setSchoolPrefects((prev) => prev.filter((p) => p.id !== row.id));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke');
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2 border-b border-slate-200">
        <button onClick={() => setTab('class')} className={`px-4 py-2 text-sm font-medium border-b-2 ${tab === 'class' ? 'border-slate-900 text-slate-900' : 'border-transparent text-slate-400'}`}>
          Class Prefects
        </button>
        <button onClick={() => setTab('school')} className={`px-4 py-2 text-sm font-medium border-b-2 ${tab === 'school' ? 'border-slate-900 text-slate-900' : 'border-transparent text-slate-400'}`}>
          School Prefects
        </button>
      </div>

      {error && <p className="text-sm text-rose-600 bg-rose-50 rounded-lg px-3 py-2">{error}</p>}

      {tab === 'class' && (
        <div>
          <p className="text-sm text-slate-500 mb-3">
            Class Teachers assign Class Prefects from the class detail page — admins can view and revoke here, but not assign directly.
          </p>
          <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
            {classRows.map((c) => (
              <div key={c.id} className="flex items-center justify-between px-5 py-3">
                <div>
                  <p className="font-medium text-sm text-slate-800">{c.name}</p>
                  {c.prefect ? (
                    <p className="text-xs text-slate-500">
                      {c.prefect.student.user.full_name} · assigned {new Date(c.prefect.assigned_at).toLocaleDateString()}
                    </p>
                  ) : (
                    <p className="text-xs text-slate-400">None</p>
                  )}
                </div>
                {c.prefect && (
                  <button onClick={() => revokeClassPrefect(c)} className="text-xs text-slate-400 hover:text-rose-600 transition-colors">
                    Revoke
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'school' && (
        <div className="space-y-4">
          <button onClick={() => setShowAssignForm((v) => !v)} className="bg-slate-900 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-slate-700">
            {showAssignForm ? 'Cancel' : '+ Assign School Prefect'}
          </button>

          {showAssignForm && (
            <form onSubmit={assignSchoolPrefect} className="bg-white border border-slate-200 rounded-lg p-5 space-y-4 max-w-md">
              <div>
                <label className="block text-sm font-medium text-slate-700">Role title</label>
                <input value={roleTitle} onChange={(e) => setRoleTitle(e.target.value)} required placeholder="Head Boy, Head Girl, Games Captain…"
                  className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">Student</label>
                <input value={selectedStudentId ? students.find((s) => s.id === selectedStudentId)?.user.full_name ?? '' : studentQuery}
                  onChange={(e) => { setStudentQuery(e.target.value); setSelectedStudentId(''); }}
                  placeholder="Search by name or admission no." required
                  className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
                {filteredStudents.length > 0 && !selectedStudentId && (
                  <div className="mt-1 border border-slate-200 rounded-md max-h-40 overflow-y-auto">
                    {filteredStudents.slice(0, 20).map((s) => (
                      <button type="button" key={s.id} onClick={() => { setSelectedStudentId(s.id); setStudentQuery(''); }}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 border-b border-slate-100 last:border-0">
                        {s.user.full_name} <span className="text-slate-400">({s.admission_no})</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button type="submit" disabled={assigning || !selectedStudentId} className="bg-slate-900 text-white px-4 py-2 rounded-md text-sm disabled:opacity-50">
                {assigning ? 'Assigning…' : 'Assign'}
              </button>
            </form>
          )}

          {schoolPrefects.length === 0 ? (
            <p className="text-sm text-slate-500">No active School Prefects.</p>
          ) : (
            <div className="bg-white border border-slate-200 rounded-lg divide-y divide-slate-100">
              {schoolPrefects.map((p) => (
                <div key={p.id} className="flex items-center justify-between px-5 py-3">
                  <div>
                    <p className="font-medium text-sm text-slate-800">{p.role_title}</p>
                    <p className="text-xs text-slate-500">{p.student.user.full_name} ({p.student.admission_no}) · assigned {new Date(p.assigned_at).toLocaleDateString()}</p>
                  </div>
                  <button onClick={() => revokeSchoolPrefect(p)} className="text-xs text-slate-400 hover:text-rose-600 transition-colors">Revoke</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
