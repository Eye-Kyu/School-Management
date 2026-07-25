'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';

type AbsenceRequest = {
  id: string; student_id: string; start_date: string; end_date: string; reason: string;
  status: 'PENDING' | 'APPROVED' | 'DENIED'; denial_reason: string | null; created_at: string;
  student: { admission_no: string; user: { full_name: string } } | null;
  requested_by: { full_name: string } | null;
};

const STATUS_STYLE: Record<string, string> = {
  PENDING: 'bg-amber-100 text-amber-700',
  APPROVED: 'bg-emerald-100 text-emerald-700',
  DENIED: 'bg-rose-100 text-rose-700',
};

// Shared between the Admin and Class Teacher absence-request review
// screens — both eligible approvers see the exact same queue UI, scoped by
// RLS on the /absence-requests list endpoint (Admin sees all, a Class
// Teacher only sees requests for their own class's students).
export default function AbsenceRequestReviewQueue() {
  const [requests, setRequests] = useState<AbsenceRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [denyReasonFor, setDenyReasonFor] = useState<string | null>(null);
  const [denyReason, setDenyReason] = useState('');

  function load() {
    setLoading(true);
    apiFetch<AbsenceRequest[]>('/absence-requests')
      .then(setRequests)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }
  useEffect(load, []);

  async function review(id: string, action: 'APPROVE' | 'DENY') {
    setBusyId(id);
    setError('');
    try {
      await apiFetch(`/absence-requests/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ action, denialReason: action === 'DENY' ? denyReason : undefined }),
      });
      setDenyReasonFor(null); setDenyReason('');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update request');
    } finally {
      setBusyId(null);
    }
  }

  if (loading) return <p className="text-sm text-slate-400">Loading…</p>;

  const pending = requests.filter((r) => r.status === 'PENDING');
  const decided = requests.filter((r) => r.status !== 'PENDING');

  function Card({ r }: { r: AbsenceRequest }) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-slate-800">{r.student?.user?.full_name ?? 'Student'} ({r.student?.admission_no ?? '—'})</p>
            <p className="text-xs text-slate-400">{r.start_date} to {r.end_date} · requested by {r.requested_by?.full_name ?? '—'}</p>
          </div>
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full shrink-0 ${STATUS_STYLE[r.status]}`}>{r.status}</span>
        </div>
        <p className="text-sm text-slate-600">{r.reason}</p>
        {r.status === 'DENIED' && r.denial_reason && <p className="text-xs text-rose-600">Reason: {r.denial_reason}</p>}

        {r.status === 'PENDING' && (
          denyReasonFor === r.id ? (
            <div className="space-y-2">
              <textarea value={denyReason} onChange={(e) => setDenyReason(e.target.value)} rows={2} placeholder="Reason for denial"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm resize-none" />
              <div className="flex gap-2">
                <button onClick={() => review(r.id, 'DENY')} disabled={busyId === r.id || !denyReason.trim()}
                  className="text-xs bg-rose-600 text-white px-3 py-1.5 rounded-md disabled:opacity-50">Confirm deny</button>
                <button onClick={() => { setDenyReasonFor(null); setDenyReason(''); }} className="text-xs text-slate-400">Cancel</button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2">
              <button onClick={() => review(r.id, 'APPROVE')} disabled={busyId === r.id}
                className="text-xs bg-emerald-600 text-white px-3 py-1.5 rounded-md hover:bg-emerald-500 disabled:opacity-50">Approve</button>
              <button onClick={() => setDenyReasonFor(r.id)} disabled={busyId === r.id}
                className="text-xs border border-slate-300 px-3 py-1.5 rounded-md hover:bg-slate-50 disabled:opacity-50">Deny</button>
            </div>
          )
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && <p className="text-sm text-rose-600 bg-rose-50 rounded-lg px-3 py-2">{error}</p>}

      <div>
        <h2 className="text-sm font-semibold text-slate-700 mb-2">Pending ({pending.length})</h2>
        {pending.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 bg-white p-6 text-center text-sm text-slate-400">Nothing pending.</div>
        ) : (
          <div className="space-y-3">{pending.map((r) => <Card key={r.id} r={r} />)}</div>
        )}
      </div>

      {decided.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-slate-700 mb-2">Decided</h2>
          <div className="space-y-3">{decided.map((r) => <Card key={r.id} r={r} />)}</div>
        </div>
      )}
    </div>
  );
}
