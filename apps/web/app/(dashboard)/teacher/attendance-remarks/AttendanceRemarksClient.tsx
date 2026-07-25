'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';

type Item = { student_id: string; current_status: string; proposed_status: string; proposed_note: string | null; student: { admission_no: string; user: { full_name: string } } };
type RemarkRequest = {
  id: string; class_id: string; date: string; reason: string; status: 'PENDING' | 'APPROVED' | 'DENIED';
  reviewed_at: string | null; denial_reason: string | null; applied_at: string | null; expires_at: string; created_at: string;
  requested_by_user_id: string; requested_by: { full_name: string } | null;
  class: { name: string } | null; items: Item[];
};

export default function AttendanceRemarksClient({ isDepartmentHead, myUserId }: { isDepartmentHead: boolean; myUserId: string }) {
  const [requests, setRequests] = useState<RemarkRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [denyReasonFor, setDenyReasonFor] = useState<string | null>(null);
  const [denyReason, setDenyReason] = useState('');

  function load() {
    setLoading(true);
    apiFetch<RemarkRequest[]>('/attendance/remark-requests')
      .then(setRequests)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }
  useEffect(load, []);

  const mine = requests.filter((r) => r.requested_by_user_id === myUserId);
  const toReview = isDepartmentHead ? requests.filter((r) => r.requested_by_user_id !== myUserId && r.status === 'PENDING') : [];

  async function review(id: string, action: 'APPROVE' | 'DENY') {
    setBusyId(id);
    setError('');
    try {
      await apiFetch(`/attendance/remark-requests/${id}`, {
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

  async function applyApproved(r: RemarkRequest) {
    setBusyId(r.id);
    setError('');
    try {
      await apiFetch('/attendance', {
        method: 'POST',
        body: JSON.stringify({
          classId: r.class_id, date: r.date,
          records: r.items.map((i) => ({ studentId: i.student_id, status: i.proposed_status, note: i.proposed_note ?? undefined })),
        }),
      });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to apply changes');
    } finally {
      setBusyId(null);
    }
  }

  if (loading) return <p className="text-sm text-slate-400">Loading…</p>;

  function RequestCard({ r, showReview }: { r: RemarkRequest; showReview: boolean }) {
    const expired = r.status === 'PENDING' && new Date(r.expires_at).getTime() < Date.now();
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-slate-800">{r.class?.name ?? 'Class'} · {r.date}</p>
            <p className="text-xs text-slate-400">{r.requested_by?.full_name ?? '—'} · {new Date(r.created_at).toLocaleString()}</p>
          </div>
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full shrink-0 ${
            r.status === 'PENDING' ? 'bg-amber-100 text-amber-700' : r.status === 'APPROVED' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'
          }`}>{expired ? 'EXPIRED' : r.status}</span>
        </div>
        <p className="text-sm text-slate-600">{r.reason}</p>
        <ul className="text-xs text-slate-500 list-disc list-inside">
          {r.items.map((i) => (
            <li key={i.student_id}>{i.student.user.full_name} ({i.student.admission_no}): {i.current_status} → {i.proposed_status}</li>
          ))}
        </ul>
        {r.status === 'DENIED' && r.denial_reason && <p className="text-xs text-rose-600">Reason: {r.denial_reason}</p>}

        {r.status === 'APPROVED' && !r.applied_at && !expired && (
          <button onClick={() => applyApproved(r)} disabled={busyId === r.id}
            className="text-xs font-medium bg-slate-900 text-white px-3 py-1.5 rounded-md disabled:opacity-50">
            {busyId === r.id ? 'Applying…' : 'Apply your requested changes'}
          </button>
        )}
        {r.status === 'APPROVED' && r.applied_at && <p className="text-xs text-emerald-600">Applied.</p>}

        {showReview && r.status === 'PENDING' && !expired && (
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

      {isDepartmentHead && (
        <div>
          <h2 className="text-sm font-semibold text-slate-700 mb-2">Pending review ({toReview.length})</h2>
          {toReview.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 bg-white p-6 text-center text-sm text-slate-400">Nothing pending.</div>
          ) : (
            <div className="space-y-3">{toReview.map((r) => <RequestCard key={r.id} r={r} showReview />)}</div>
          )}
        </div>
      )}

      <div>
        <h2 className="text-sm font-semibold text-slate-700 mb-2">My requests</h2>
        {mine.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 bg-white p-6 text-center text-sm text-slate-400">No re-marking requests yet.</div>
        ) : (
          <div className="space-y-3">{mine.map((r) => <RequestCard key={r.id} r={r} showReview={false} />)}</div>
        )}
      </div>
    </div>
  );
}
