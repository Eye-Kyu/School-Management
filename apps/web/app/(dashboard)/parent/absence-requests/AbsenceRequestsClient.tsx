'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';

type AbsenceRequest = {
  id: string; student_id: string; start_date: string; end_date: string; reason: string;
  status: 'PENDING' | 'APPROVED' | 'DENIED'; denial_reason: string | null; created_at: string;
  student: { admission_no: string; user: { full_name: string } } | null;
};

const STATUS_STYLE: Record<string, string> = {
  PENDING: 'bg-amber-100 text-amber-700',
  APPROVED: 'bg-emerald-100 text-emerald-700',
  DENIED: 'bg-rose-100 text-rose-700',
};

export default function AbsenceRequestsClient({ students }: { students: { id: string; name: string }[] }) {
  const [studentId, setStudentId] = useState(students[0]?.id ?? '');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const [requests, setRequests] = useState<AbsenceRequest[]>([]);
  const [loading, setLoading] = useState(true);

  function load() {
    setLoading(true);
    apiFetch<AbsenceRequest[]>('/absence-requests').then(setRequests).catch(() => {}).finally(() => setLoading(false));
  }
  useEffect(load, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!studentId || !startDate || !endDate || reason.trim().length < 10) return;
    setSubmitting(true);
    setError('');
    try {
      await apiFetch('/absence-requests', {
        method: 'POST',
        body: JSON.stringify({ studentId, startDate, endDate, reason: reason.trim() }),
      });
      setStartDate(''); setEndDate(''); setReason('');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit absence request');
    } finally {
      setSubmitting(false);
    }
  }

  if (students.length === 0) {
    return <p className="text-sm text-slate-400">No linked children found on your account.</p>;
  }

  return (
    <div className="space-y-6">
      <form onSubmit={handleSubmit} className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
        {error && <p className="text-sm text-rose-600 bg-rose-50 rounded px-3 py-2">{error}</p>}
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Child</label>
          <select value={studentId} onChange={(e) => setStudentId(e.target.value)}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm w-full">
            {students.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div className="flex gap-3">
          <div className="flex-1">
            <label className="block text-xs font-medium text-slate-600 mb-1">From</label>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm w-full" />
          </div>
          <div className="flex-1">
            <label className="block text-xs font-medium text-slate-600 mb-1">To</label>
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} min={startDate || undefined}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm w-full" />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Reason</label>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} minLength={10}
            placeholder="At least 10 characters"
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm resize-none" />
        </div>
        <button type="submit" disabled={submitting || !studentId || !startDate || !endDate || reason.trim().length < 10}
          className="bg-slate-900 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-slate-700 disabled:opacity-50">
          {submitting ? 'Submitting…' : 'Submit request'}
        </button>
      </form>

      <div>
        <h2 className="text-sm font-semibold text-slate-700 mb-2">My requests</h2>
        {loading ? (
          <p className="text-sm text-slate-400">Loading…</p>
        ) : requests.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 bg-white p-6 text-center text-sm text-slate-400">No absence requests yet.</div>
        ) : (
          <div className="space-y-3">
            {requests.map((r) => (
              <div key={r.id} className="bg-white border border-slate-200 rounded-xl p-4 space-y-1">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-slate-800">{r.student?.user?.full_name ?? 'Child'}</p>
                    <p className="text-xs text-slate-400">{r.start_date} to {r.end_date}</p>
                  </div>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full shrink-0 ${STATUS_STYLE[r.status]}`}>{r.status}</span>
                </div>
                <p className="text-sm text-slate-600">{r.reason}</p>
                {r.status === 'DENIED' && r.denial_reason && <p className="text-xs text-rose-600">Reason: {r.denial_reason}</p>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
