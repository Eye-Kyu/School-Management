'use client';

import { useState } from 'react';
import { apiFetch } from '@/lib/api';

type Report = {
  id: string; student_id: string; category: string; description: string; status: 'PENDING' | 'REVIEWED' | 'DISMISSED';
  class_teacher_notes: string | null; created_at: string;
  reported_by: { full_name: string } | null;
  student: { admission_no: string; user: { full_name: string } };
};

export default function BehaviorIncidentsClient({ initialReports }: { initialReports: Report[] }) {
  const [reports, setReports] = useState(initialReports);
  const [error, setError] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [convert, setConvert] = useState(false);
  const [points, setPoints] = useState(1);
  const [pointCategory, setPointCategory] = useState<'POSITIVE' | 'NEGATIVE'>('POSITIVE');
  const [busy, setBusy] = useState(false);

  const pending = reports.filter((r) => r.status === 'PENDING');
  const decided = reports.filter((r) => r.status !== 'PENDING');

  async function review(report: Report, action: 'DISMISS' | 'MARK_REVIEWED') {
    setBusy(true);
    setError('');
    try {
      await apiFetch(`/prefects/behavior-incidents/${report.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          action,
          classTeacherNotes: notes || undefined,
          convertToPoints: action === 'MARK_REVIEWED' && convert
            ? { category: pointCategory, points, reason: `Behavior incident report: ${report.description.slice(0, 200)}` }
            : undefined,
        }),
      });
      setReports((prev) => prev.map((r) => (r.id === report.id ? { ...r, status: action === 'DISMISS' ? 'DISMISSED' : 'REVIEWED', class_teacher_notes: notes || null } : r)));
      setOpenId(null); setNotes(''); setConvert(false); setPoints(1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update report');
    } finally {
      setBusy(false);
    }
  }

  function ReportRow({ report, actionable }: { report: Report; actionable: boolean }) {
    return (
      <div className="px-5 py-4 border-b border-slate-100 last:border-0">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <p className="font-medium text-slate-800 text-sm">
              {report.student.user.full_name} <span className="text-slate-400 font-normal">({report.student.admission_no})</span>
            </p>
            <p className="text-xs text-slate-400 mt-0.5">
              Reported by {report.reported_by?.full_name ?? '—'} · {new Date(report.created_at).toLocaleString()} · {report.category}
            </p>
            <p className="text-sm text-slate-600 mt-1">{report.description}</p>
            {report.class_teacher_notes && <p className="text-xs text-slate-500 mt-1 italic">Notes: {report.class_teacher_notes}</p>}
          </div>
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full shrink-0 ${
            report.status === 'PENDING' ? 'bg-amber-100 text-amber-700' : report.status === 'REVIEWED' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'
          }`}>{report.status}</span>
        </div>

        {actionable && (
          openId === report.id ? (
            <div className="mt-3 bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-2">
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Notes (optional)"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm resize-none" />
              <label className="flex items-center gap-2 text-xs text-slate-600">
                <input type="checkbox" checked={convert} onChange={(e) => setConvert(e.target.checked)} />
                Convert to a behavior points entry
              </label>
              {convert && (
                <div className="flex items-center gap-2">
                  <select value={pointCategory} onChange={(e) => setPointCategory(e.target.value as 'POSITIVE' | 'NEGATIVE')} className="rounded-md border border-slate-300 px-2 py-1 text-xs">
                    <option value="POSITIVE">Positive</option>
                    <option value="NEGATIVE">Negative</option>
                  </select>
                  <input type="number" min={1} max={10} value={points} onChange={(e) => setPoints(Number(e.target.value))} className="w-16 rounded-md border border-slate-300 px-2 py-1 text-xs" />
                  <span className="text-xs text-slate-400">points</span>
                </div>
              )}
              <div className="flex gap-2">
                <button onClick={() => review(report, 'MARK_REVIEWED')} disabled={busy} className="text-xs bg-emerald-600 text-white px-3 py-1.5 rounded-md hover:bg-emerald-500 disabled:opacity-50">Mark reviewed</button>
                <button onClick={() => review(report, 'DISMISS')} disabled={busy} className="text-xs border border-slate-300 px-3 py-1.5 rounded-md hover:bg-white disabled:opacity-50">Dismiss</button>
                <button onClick={() => { setOpenId(null); setNotes(''); setConvert(false); }} className="text-xs text-slate-400 hover:text-slate-600">Cancel</button>
              </div>
            </div>
          ) : (
            <button onClick={() => setOpenId(report.id)} className="mt-2 text-xs font-medium text-slate-600 border border-slate-300 px-3 py-1 rounded-md hover:bg-slate-50">
              Review
            </button>
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
          <div className="rounded-xl border border-dashed border-slate-200 bg-white p-8 text-center text-sm text-slate-400">No pending reports.</div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-xl">
            {pending.map((r) => <ReportRow key={r.id} report={r} actionable />)}
          </div>
        )}
      </div>

      {decided.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-slate-700 mb-2">Reviewed / Dismissed</h2>
          <div className="bg-white border border-slate-200 rounded-xl">
            {decided.map((r) => <ReportRow key={r.id} report={r} actionable={false} />)}
          </div>
        </div>
      )}
    </div>
  );
}
