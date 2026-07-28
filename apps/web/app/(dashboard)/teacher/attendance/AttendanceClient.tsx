'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Badge } from '@school-manager/ui';
import { apiFetch } from '@/lib/api';

type RosterStudent = {
  id: string;
  admissionNo: string;
  fullName: string;
  attendance: { status: string; note: string | null } | null;
  excusedByAbsenceRequest: boolean;
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

type CurrentPrefect = { id: string; studentId: string; fullName: string } | null;

export default function AttendanceClient({
  classes,
  selectedClassId,
  date: initialDate,
  roster: initialRoster,
  isClassTeacher,
  currentPrefect: initialPrefect,
}: {
  classes: ClassOption[];
  selectedClassId: string;
  date: string;
  roster: RosterStudent[];
  isClassTeacher: boolean;
  currentPrefect: CurrentPrefect;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
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
  const [currentPrefect, setCurrentPrefect] = useState<CurrentPrefect>(initialPrefect);
  const [showPrefectPicker, setShowPrefectPicker] = useState(false);
  const [prefectStudentId, setPrefectStudentId] = useState('');
  const [settingPrefect, setSettingPrefect] = useState(false);
  const [showRemarkReason, setShowRemarkReason] = useState(false);
  const [remarkReason, setRemarkReason] = useState('');

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

  async function handleAssignPrefect() {
    if (!classId || !prefectStudentId) return;
    setSettingPrefect(true);
    setError('');
    try {
      if (currentPrefect) {
        const reason = prompt('Reason for changing the Class Prefect?');
        if (reason === null) { setSettingPrefect(false); return; }
        await apiFetch('/prefects/class/change', {
          method: 'POST',
          body: JSON.stringify({ classId, studentId: prefectStudentId, termId: null, reason }),
        });
      } else {
        await apiFetch('/prefects/class', {
          method: 'POST',
          body: JSON.stringify({ classId, studentId: prefectStudentId, termId: null }),
        });
      }
      const student = roster.find((s) => s.id === prefectStudentId);
      setCurrentPrefect({ id: '', studentId: prefectStudentId, fullName: student?.fullName ?? '' });
      setShowPrefectPicker(false);
      setPrefectStudentId('');
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to set prefect');
    } finally {
      setSettingPrefect(false);
    }
  }

  // Approved-absence-covered students are non-editable here (see the amber
  // banner + disabled row below) — they're excluded from "already
  // submitted" detection, from the changed-students diff, and from every
  // payload sent to the API, so they never appear as an "override attempt."
  const editableRoster = roster.filter((s) => !s.excusedByAbsenceRequest);
  const hasExisting = editableRoster.some((s) => s.attendance !== null);
  const changedStudents = editableRoster.filter((s) => (statuses[s.id] ?? 'PRESENT') !== (s.attendance?.status ?? 'PRESENT'));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!classId || roster.length === 0) return;
    if (editableRoster.length === 0) { setError('Every student in this class has an approved absence for this day — nothing to mark.'); return; }

    if (hasExisting) {
      if (changedStudents.length === 0) { setError('No changes selected — pick a different status for at least one student.'); return; }
      setShowRemarkReason(true);
      return;
    }

    setSaving(true);
    setError('');
    setSaved(false);
    try {
      const records = editableRoster.map((s) => ({
        studentId: s.id,
        status: statuses[s.id] ?? 'PRESENT',
      }));
      await apiFetch('/attendance', {
        method: 'POST',
        body: JSON.stringify({ classId, date, records }),
      });
      setSaved(true);
      // The teacher dashboard's "Today's Checklist" auto-checks attendance
      // via a live TanStack Query — invalidate it so it flips immediately
      // when the teacher navigates back, without a manual page reload.
      queryClient.invalidateQueries({ queryKey: ['todays-checklist'] });
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save attendance');
    } finally {
      setSaving(false);
    }
  }

  async function submitRemarkRequest() {
    if (!classId || remarkReason.trim().length < 20) return;
    setSaving(true);
    setError('');
    try {
      await apiFetch('/attendance/remark-requests', {
        method: 'POST',
        body: JSON.stringify({
          classId, date, reason: remarkReason.trim(),
          items: changedStudents.map((s) => ({ studentId: s.id, proposedStatus: statuses[s.id] ?? 'PRESENT' })),
        }),
      });
      setSaved(true);
      setShowRemarkReason(false);
      setRemarkReason('');
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit re-marking request');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* Class + date selectors */}
      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label htmlFor="attendance-class" className="block text-xs font-medium text-slate-600 mb-1">Class</label>
          <select
            id="attendance-class"
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
          <label htmlFor="attendance-date" className="block text-xs font-medium text-slate-600 mb-1">Date</label>
          <input
            id="attendance-date"
            type="date"
            value={date}
            onChange={handleDateChange}
            aria-label="Date"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
      </div>

      {isClassTeacher && classId && initialRoster.length > 0 && (
        <div className="flex items-center gap-3 bg-slate-50 border border-slate-200 rounded-lg px-4 py-3 flex-wrap">
          {/* A section caption, not a form-control label — several conditionally-rendered controls follow, not one fixed control to point `htmlFor` at. */}
          <span className="text-sm font-medium text-slate-700 shrink-0">Class Prefect</span>
          {!showPrefectPicker ? (
            currentPrefect ? (
              <>
                <span className="text-sm text-slate-800">{currentPrefect.fullName}</span>
                <button type="button" onClick={() => setShowPrefectPicker(true)}
                  className="text-xs font-medium text-slate-600 border border-slate-300 px-3 py-1 rounded-md hover:bg-white">
                  Change Prefect
                </button>
              </>
            ) : (
              <button type="button" onClick={() => setShowPrefectPicker(true)}
                className="text-xs font-medium text-white bg-slate-900 px-3 py-1.5 rounded-md hover:bg-slate-700">
                Assign Class Prefect
              </button>
            )
          ) : (
            <>
              <select
                value={prefectStudentId}
                onChange={(e) => setPrefectStudentId(e.target.value)}
                disabled={settingPrefect}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-50"
              >
                <option value="">— choose a student —</option>
                {initialRoster.map((s) => (
                  <option key={s.id} value={s.id}>{s.fullName} ({s.admissionNo})</option>
                ))}
              </select>
              <button type="button" onClick={handleAssignPrefect} disabled={settingPrefect || !prefectStudentId}
                className="text-xs font-medium text-white bg-slate-900 px-3 py-1.5 rounded-md hover:bg-slate-700 disabled:opacity-50">
                {settingPrefect ? 'Saving…' : 'Confirm'}
              </button>
              <button type="button" onClick={() => { setShowPrefectPicker(false); setPrefectStudentId(''); }}
                className="text-xs text-slate-500 hover:text-slate-600">Cancel</button>
            </>
          )}
        </div>
      )}

      {isClassTeacher && classId && (
        <div className="flex items-center gap-3 bg-slate-50 border border-slate-200 rounded-lg px-4 py-3">
          <span className="text-sm font-medium text-slate-700 shrink-0">Class reports</span>
          <button
            type="button"
            onClick={handleExportGrades}
            disabled={exportingGrades}
            className="text-xs font-medium text-slate-600 border border-slate-300 px-3 py-1.5 rounded-md hover:bg-white disabled:opacity-50"
          >
            {exportingGrades ? 'Exporting…' : 'Export grades (all subjects)'}
          </button>
          <span className="text-xs text-slate-500">Use "↓ Export CSV" below for attendance.</span>
        </div>
      )}

      {!classId ? (
        <div className="bg-white border border-slate-200 rounded-lg px-5 py-10 text-center text-sm text-slate-500">
          Select a class above to load the student roster.
        </div>
      ) : isPending ? (
        <div className="text-sm text-slate-500 py-6 text-center">Loading roster…</div>
      ) : roster.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-lg px-5 py-10 text-center text-sm text-slate-500">
          No students in this class.
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-3">
          {error && (
            <p role="alert" className="text-sm text-red-600 bg-red-50 rounded px-3 py-2">{error}</p>
          )}
          {saved && (
            <p className="text-sm text-green-700 bg-green-50 rounded px-3 py-2">
              {hasExisting
                ? 'Re-marking request submitted. You can apply the change once your Department Head approves it — see "My Requests".'
                : `Attendance saved for ${editableRoster.length} student${editableRoster.length !== 1 ? 's' : ''}.`}
            </p>
          )}
          {hasExisting && !saved && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
              Attendance for this day is already submitted. Changing a status below and saving will submit a re-marking request for Department Head approval — it won&apos;t change anything immediately.
            </p>
          )}
          {showRemarkReason && (
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-2">
              <p className="text-xs text-slate-600">
                Requesting to change {changedStudents.length} student{changedStudents.length !== 1 ? 's' : ''}. Reason (at least 20 characters):
              </p>
              <textarea value={remarkReason} onChange={(e) => setRemarkReason(e.target.value)} rows={2} minLength={20}
                aria-label="Reason for re-marking request"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm resize-none" />
              <div className="flex gap-2">
                <button type="button" onClick={submitRemarkRequest} disabled={saving || remarkReason.trim().length < 20}
                  className="text-xs font-medium bg-slate-900 text-white px-3 py-1.5 rounded-md disabled:opacity-50">
                  {saving ? 'Submitting…' : 'Submit request'}
                </button>
                <button type="button" onClick={() => setShowRemarkReason(false)} className="text-xs text-slate-500 hover:text-slate-600">Cancel</button>
              </div>
            </div>
          )}

          {/* Roster table */}
          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium text-slate-500">Student</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-slate-500">Adm No</th>
                  {STATUSES.map((s) => (
                    <th key={s} scope="col" className="px-3 py-2 text-center text-xs font-medium text-slate-500">
                      {STATUS_LABEL[s]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {roster.map((student) => {
                  const current = statuses[student.id] ?? 'PRESENT';
                  const locked = student.excusedByAbsenceRequest;
                  return (
                    <tr key={student.id} className={locked ? 'bg-slate-50 text-slate-500' : 'hover:bg-slate-50'}>
                      <td className="px-4 py-2.5 font-medium">
                        {student.fullName}
                        {currentPrefect?.studentId === student.id && (
                          <Badge variant="classPrefect" className="ml-2">Prefect</Badge>
                        )}
                        {locked && (
                          <Badge variant="secondary" className="ml-2">Approved absence</Badge>
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
                            disabled={locked}
                            onChange={() => setStatus(student.id, s)}
                            aria-label={`${student.fullName} — ${STATUS_LABEL[s]}`}
                            className="accent-slate-700 disabled:opacity-40"
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
                onClick={() => setStatuses((prev) => ({ ...prev, ...Object.fromEntries(editableRoster.map((st) => [st.id, s])) }))}
                className={`px-2 py-0.5 rounded border text-xs ${STATUS_STYLE[s]}`}
              >
                {STATUS_LABEL[s]}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <button
              type="submit"
              disabled={saving || (hasExisting && changedStudents.length === 0)}
              className="bg-slate-900 text-white px-5 py-2 rounded-md text-sm font-medium
                         hover:bg-slate-700 disabled:opacity-50"
            >
              {saving ? 'Saving…' : hasExisting ? 'Request Re-marking' : 'Save attendance'}
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
            <span className="text-xs text-slate-500">{roster.length} student{roster.length !== 1 ? 's' : ''}</span>
          </div>
        </form>
      )}
    </div>
  );
}
