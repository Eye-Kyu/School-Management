'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';

type RosterStudent = {
  id: string;
  admissionNo: string;
  fullName: string;
  attendance: { status: string; note: string | null } | null;
};

type ClassOption = { id: string; name: string; grade_level: number };

const STATUSES = ['PRESENT', 'ABSENT', 'LATE', 'EXCUSED'] as const;
type Status = typeof STATUSES[number];

const STATUS_LABEL: Record<Status, string> = {
  PRESENT: 'Present',
  ABSENT: 'Absent',
  LATE: 'Late',
  EXCUSED: 'Excused',
};

const STATUS_STYLE: Record<Status, string> = {
  PRESENT: 'bg-green-50 border-green-300 text-green-700',
  ABSENT:  'bg-red-50 border-red-300 text-red-700',
  LATE:    'bg-yellow-50 border-yellow-300 text-yellow-700',
  EXCUSED: 'bg-slate-50 border-slate-300 text-slate-600',
};

export default function AttendanceClient({
  classes,
  selectedClassId,
  date: initialDate,
  roster: initialRoster,
  isClassTeacher,
  currentPrefectId: initialPrefectId,
}: {
  classes: ClassOption[];
  selectedClassId: string;
  date: string;
  roster: RosterStudent[];
  isClassTeacher: boolean;
  currentPrefectId: string | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [classId, setClassId] = useState(selectedClassId);
  const [date, setDate] = useState(initialDate);
  const [statuses, setStatuses] = useState<Record<string, Status>>(() =>
    Object.fromEntries(
      initialRoster.map((s) => [
        s.id,
        (s.attendance?.status as Status) ?? 'PRESENT',
      ]),
    ),
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportingGrades, setExportingGrades] = useState(false);
  const [prefectId, setPrefectId] = useState<string | null>(initialPrefectId);
  const [settingPrefect, setSettingPrefect] = useState(false);

  const roster = initialRoster;

  function navigate(newClassId: string, newDate: string) {
    const params = new URLSearchParams();
    if (newClassId) params.set('classId', newClassId);
    if (newDate) params.set('date', newDate);
    startTransition(() => router.push(`/teacher/attendance?${params.toString()}`));
  }

  function handleClassChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const id = e.target.value;
    setClassId(id);
    if (id) navigate(id, date);
  }

  function handleDateChange(e: React.ChangeEvent<HTMLInputElement>) {
    const d = e.target.value;
    setDate(d);
    if (classId) navigate(classId, d);
  }

  function setStatus(studentId: string, status: Status) {
    setSaved(false);
    setStatuses((prev) => ({ ...prev, [studentId]: status }));
  }

  async function handleExport() {
    setExporting(true);
    try {
      const params = new URLSearchParams();
      if (classId) params.set('classId', classId);
      const { csv, filename } = await apiFetch<{ csv: string; filename: string }>(
        `/attendance/export?${params.toString()}`,
      );
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }

  async function handleExportGrades() {
    if (!classId) return;
    setExportingGrades(true);
    try {
      const { csv, filename } = await apiFetch<{ csv: string; filename: string }>(
        `/assessments/class-report?classId=${classId}`,
      );
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to export grades');
    } finally {
      setExportingGrades(false);
    }
  }

  async function handleSetPrefect(studentId: string | null) {
    if (!classId) return;
    setSettingPrefect(true);
    try {
      await apiFetch(`/classes/${classId}/prefect`, {
        method: 'PATCH',
        body: JSON.stringify({ studentId }),
      });
      setPrefectId(studentId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to set prefect');
    } finally {
      setSettingPrefect(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!classId || roster.length === 0) return;
    setSaving(true);
    setError('');
    setSaved(false);

    try {
      const records = roster.map((s) => ({
        studentId: s.id,
        status: statuses[s.id] ?? 'PRESENT',
      }));
      await apiFetch('/attendance', {
        method: 'POST',
        body: JSON.stringify({ classId, date, records }),
      });
      setSaved(true);
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save attendance');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* Class + date selectors */}
      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Class</label>
          <select
            value={classId}
            onChange={handleClassChange}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm min-w-44"
          >
            <option value="">— select class —</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Date</label>
          <input
            type="date"
            value={date}
            onChange={handleDateChange}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
      </div>

      {isClassTeacher && classId && initialRoster.length > 0 && (
        <div className="flex items-center gap-3 bg-slate-50 border border-slate-200 rounded-lg px-4 py-3">
          <label className="text-sm font-medium text-slate-700 shrink-0">Class Prefect</label>
          <select
            value={prefectId ?? ''}
            onChange={(e) => handleSetPrefect(e.target.value || null)}
            disabled={settingPrefect}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-50"
          >
            <option value="">— none —</option>
            {initialRoster.map((s) => (
              <option key={s.id} value={s.id}>{s.fullName} ({s.admissionNo})</option>
            ))}
          </select>
          {settingPrefect && <span className="text-xs text-slate-400">Saving…</span>}
        </div>
      )}

      {isClassTeacher && classId && (
        <div className="flex items-center gap-3 bg-slate-50 border border-slate-200 rounded-lg px-4 py-3">
          <label className="text-sm font-medium text-slate-700 shrink-0">Class reports</label>
          <button
            type="button"
            onClick={handleExportGrades}
            disabled={exportingGrades}
            className="text-xs font-medium text-slate-600 border border-slate-300 px-3 py-1.5 rounded-md hover:bg-white disabled:opacity-50"
          >
            {exportingGrades ? 'Exporting…' : 'Export grades (all subjects)'}
          </button>
          <span className="text-xs text-slate-400">Use "↓ Export CSV" below for attendance.</span>
        </div>
      )}

      {!classId ? (
        <div className="bg-white border border-slate-200 rounded-lg px-5 py-10 text-center text-sm text-slate-400">
          Select a class above to load the student roster.
        </div>
      ) : isPending ? (
        <div className="text-sm text-slate-400 py-6 text-center">Loading roster…</div>
      ) : roster.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-lg px-5 py-10 text-center text-sm text-slate-400">
          No students in this class.
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-3">
          {error && (
            <p className="text-sm text-red-600 bg-red-50 rounded px-3 py-2">{error}</p>
          )}
          {saved && (
            <p className="text-sm text-green-700 bg-green-50 rounded px-3 py-2">
              Attendance saved for {roster.length} student{roster.length !== 1 ? 's' : ''}.
            </p>
          )}

          {/* Roster table */}
          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium text-slate-500">Student</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-slate-500">Adm No</th>
                  {STATUSES.map((s) => (
                    <th key={s} className="px-3 py-2 text-center text-xs font-medium text-slate-500">
                      {STATUS_LABEL[s]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {roster.map((student) => {
                  const current = statuses[student.id] ?? 'PRESENT';
                  return (
                    <tr key={student.id} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5 font-medium">
                        {student.fullName}
                        {prefectId === student.id && (
                          <span className="ml-2 text-xs bg-amber-100 text-amber-700 border border-amber-200 rounded px-1.5 py-0.5">Prefect</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-slate-500 text-xs">{student.admissionNo}</td>
                      {STATUSES.map((s) => (
                        <td key={s} className="px-3 py-2.5 text-center">
                          <input
                            type="radio"
                            name={`status-${student.id}`}
                            value={s}
                            checked={current === s}
                            onChange={() => setStatus(student.id, s)}
                            className="accent-slate-700"
                          />
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Quick-select all */}
          <div className="flex items-center gap-2 flex-wrap text-xs text-slate-500">
            <span>Mark all as:</span>
            {STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatuses(Object.fromEntries(roster.map((st) => [st.id, s])))}
                className={`px-2 py-0.5 rounded border text-xs ${STATUS_STYLE[s]}`}
              >
                {STATUS_LABEL[s]}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <button
              type="submit"
              disabled={saving}
              className="bg-slate-900 text-white px-5 py-2 rounded-md text-sm font-medium
                         hover:bg-slate-700 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save attendance'}
            </button>
            <button
              type="button"
              onClick={handleExport}
              disabled={exporting || !classId}
              className="border border-slate-300 px-4 py-2 rounded-md text-sm font-medium
                         hover:bg-slate-50 disabled:opacity-50"
            >
              {exporting ? 'Exporting…' : '↓ Export CSV'}
            </button>
            <span className="text-xs text-slate-400">{roster.length} student{roster.length !== 1 ? 's' : ''}</span>
          </div>
        </form>
      )}
    </div>
  );
}
