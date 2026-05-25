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

const SAMPLE_CSV = `admissionNo,fullName,className,gender,dateOfBirth
ADM010,John Kamau,Grade 5 Blue,MALE,2014-03-15
ADM011,Jane Wanjiku,Grade 5 Blue,FEMALE,`;

export default function StudentsClient({
  initialStudents,
  classes,
}: {
  initialStudents: StudentRow[];
  classes: ClassOption[];
}) {
  const router = useRouter();
  const [students, setStudents] = useState(initialStudents);
  const [mode, setMode] = useState<'list' | 'single' | 'bulk'>('list');

  // Single enrol form state
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [admissionNo, setAdmissionNo] = useState('');
  const [classId, setClassId] = useState('');
  const [gender, setGender] = useState('');
  const [tempPassword, setTempPassword] = useState('');
  const [formError, setFormError] = useState('');
  const [formLoading, setFormLoading] = useState(false);

  // Bulk import state
  const [csv, setCsv] = useState('');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ imported: number; failed: number; rows: any[] } | null>(null);
  const [importError, setImportError] = useState('');

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setFormError('');
    const result = CreateStudentInput.safeParse({
      fullName,
      email: email || undefined,
      phone: phone || undefined,
      admissionNo,
      classId: classId || undefined,
      gender: (gender as 'MALE' | 'FEMALE' | 'OTHER') || undefined,
    });
    if (!result.success) { setFormError(result.error.issues[0]?.message ?? 'Invalid'); return; }

    setFormLoading(true);
    try {
      const created = await apiFetch<StudentRow & { temporaryPassword: string }>('/students', {
        method: 'POST',
        body: JSON.stringify(result.data),
      });
      setTempPassword(created.temporaryPassword);
      setStudents((prev) => [...prev, created]);
      setMode('list');
      setFullName(''); setEmail(''); setPhone(''); setAdmissionNo(''); setClassId(''); setGender('');
      router.refresh();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed');
    } finally { setFormLoading(false); }
  }

  async function handleImport(e: React.FormEvent) {
    e.preventDefault();
    if (!csv.trim()) return;
    setImporting(true);
    setImportError('');
    setImportResult(null);
    try {
      const res = await apiFetch<{ imported: number; failed: number; rows: any[] }>(
        '/students/import',
        { method: 'POST', body: JSON.stringify({ csv }) },
      );
      setImportResult(res);
      if (res.imported > 0) { router.refresh(); setCsv(''); }
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Import failed');
    } finally { setImporting(false); }
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
      {/* Temp password from single enrol */}
      {tempPassword && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm">
          <p className="font-medium text-amber-800">Student enrolled — temporary password:</p>
          <p className="mt-1 font-mono text-amber-700">{tempPassword}</p>
          <button onClick={() => setTempPassword('')} className="mt-2 text-xs text-amber-500 underline">Dismiss</button>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-2">
        <button
          onClick={() => setMode(mode === 'single' ? 'list' : 'single')}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            mode === 'single'
              ? 'bg-slate-200 text-slate-800'
              : 'bg-slate-900 text-white hover:bg-slate-700'
          }`}
        >
          {mode === 'single' ? 'Cancel' : '+ Enrol student'}
        </button>
        <button
          onClick={() => { setMode(mode === 'bulk' ? 'list' : 'bulk'); setImportResult(null); setImportError(''); }}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            mode === 'bulk'
              ? 'bg-slate-200 text-slate-800'
              : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-50'
          }`}
        >
          {mode === 'bulk' ? 'Cancel' : '↑ Bulk import CSV'}
        </button>
      </div>

      {/* Single enrol form */}
      {mode === 'single' && (
        <form onSubmit={handleCreate} className="bg-white border border-slate-200 rounded-lg p-5 space-y-4 max-w-md">
          {formError && <p className="text-sm text-red-600">{formError}</p>}
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
          <button type="submit" disabled={formLoading}
            className="bg-slate-900 text-white px-4 py-2 rounded-md text-sm disabled:opacity-50">
            {formLoading ? 'Enrolling…' : 'Enrol student'}
          </button>
        </form>
      )}

      {/* Bulk import form */}
      {mode === 'bulk' && (
        <form onSubmit={handleImport} className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
          <div>
            <p className="text-sm font-medium text-slate-700 mb-1">CSV format</p>
            <pre className="text-xs bg-slate-50 border border-slate-200 rounded px-3 py-2 whitespace-pre-wrap font-mono">
              {SAMPLE_CSV}
            </pre>
            <p className="text-xs text-slate-400 mt-1">
              Required: <span className="font-medium">admissionNo, fullName, className</span>. Optional: gender (MALE/FEMALE/OTHER), dateOfBirth (YYYY-MM-DD).
              <br />Class names must exactly match existing classes. A placeholder login will be generated for each student.
            </p>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Paste CSV</label>
            <textarea
              value={csv}
              onChange={(e) => setCsv(e.target.value)}
              rows={10}
              placeholder={SAMPLE_CSV}
              className="block w-full rounded border border-slate-300 px-3 py-2 text-sm font-mono"
              required
            />
          </div>
          {importError && <p className="text-sm text-red-600 bg-red-50 rounded px-3 py-2">{importError}</p>}
          {importResult && (
            <div className="space-y-2">
              <p className={importResult.imported > 0 ? 'text-sm text-emerald-700 font-medium' : 'text-sm text-slate-500'}>
                {importResult.imported} student{importResult.imported !== 1 ? 's' : ''} imported
                {importResult.failed > 0 ? `, ${importResult.failed} failed` : ''}
              </p>
              {importResult.rows.some(r => r.result === 'ok') && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <p className="text-xs font-medium text-amber-800 mb-2">Save these temporary credentials before dismissing:</p>
                  <div className="space-y-1">
                    {importResult.rows.filter(r => r.result === 'ok').map((r: any) => (
                      <p key={r.row} className="text-xs font-mono text-amber-700">
                        {r.admissionNo}: {r.tempEmail} / {r.tempPassword}
                      </p>
                    ))}
                  </div>
                </div>
              )}
              {importResult.failed > 0 && (
                <div className="space-y-1">
                  {importResult.rows.filter(r => r.result === 'error').map((r: any) => (
                    <p key={r.row} className="text-xs text-rose-600">Row {r.row}: {r.message}</p>
                  ))}
                </div>
              )}
            </div>
          )}
          <button
            type="submit"
            disabled={importing}
            className="bg-slate-900 text-white px-4 py-2 rounded text-sm disabled:opacity-50"
          >
            {importing ? 'Importing…' : 'Import students'}
          </button>
        </form>
      )}

      {/* Students list */}
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
