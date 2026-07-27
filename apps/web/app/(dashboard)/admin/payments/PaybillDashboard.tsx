'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '@/lib/api';

type UnmatchedTxn = {
  id: string;
  mpesa_receipt_number: string;
  msisdn: string;
  amount: number;
  currency: string;
  bill_reference_number: string;
  reconciliation_notes: string | null;
  created_at: string;
};

type OverpaymentTxn = {
  id: string;
  mpesa_receipt_number: string;
  amount: number;
  currency: string;
  reconciliation_notes: string | null;
  created_at: string;
  matched_student: { admission_no: string; user: { full_name: string } } | null;
};

type UnifiedRow = {
  id: string;
  source: 'manual' | 'paystack' | 'paybill';
  amount: number;
  currency: string;
  status: string;
  studentName: string | null;
  admissionNo: string | null;
  reference: string | null;
  createdAt: string;
};

type StudentOption = { id: string; admission_no: string; user: { full_name: string } };
type FeeBalanceOption = { id: string; amount_due: number; amount_paid: number; currency: string; student: { id: string }; term: { name: string } | null };

type Tab = 'unmatched' | 'overpayments' | 'unified';

const SOURCE_STYLE: Record<string, string> = {
  manual: 'bg-slate-100 text-slate-600',
  paystack: 'bg-blue-100 text-blue-700',
  paybill: 'bg-emerald-100 text-emerald-700',
};

function fmt(n: number, currency = 'KES') {
  return `${currency} ${Number(n).toLocaleString()}`;
}

export default function PaybillDashboard() {
  const [tab, setTab] = useState<Tab>('unmatched');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [unmatched, setUnmatched] = useState<UnmatchedTxn[]>([]);
  const [overpayments, setOverpayments] = useState<OverpaymentTxn[]>([]);
  const [students, setStudents] = useState<StudentOption[]>([]);
  const [feeBalances, setFeeBalances] = useState<FeeBalanceOption[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const [u, o, s, f] = await Promise.all([
        apiFetch<UnmatchedTxn[]>('/payments/paybill/unmatched'),
        apiFetch<OverpaymentTxn[]>('/payments/paybill/overpayments'),
        apiFetch<StudentOption[]>('/students'),
        apiFetch<FeeBalanceOption[]>('/fees'),
      ]);
      setUnmatched(u);
      setOverpayments(o);
      setStudents(s);
      setFeeBalances(f);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load Paybill reconciliation data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">M-Pesa Paybill reconciliation</h2>
        <p className="text-sm text-slate-500 mt-0.5">
          Transactions received via Paybill that need admin review, plus a combined view of every payment source.
        </p>
      </div>

      <div className="flex gap-2 flex-wrap">
        {([
          ['unmatched', `Unmatched (${unmatched.length})`],
          ['overpayments', `Overpayments (${overpayments.length})`],
          ['unified', 'Unified feed'],
        ] as [Tab, string][]).map(([val, label]) => (
          <button
            key={val}
            onClick={() => setTab(val)}
            className={`text-sm px-3 py-1 rounded-full font-medium transition-colors ${tab === val ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {loadError && <p className="text-sm text-red-600 bg-red-50 rounded px-3 py-2">{loadError}</p>}

      {loading ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-white p-10 text-center text-sm text-slate-400">Loading…</div>
      ) : (
        <>
          {tab === 'unmatched' && <UnmatchedQueue rows={unmatched} students={students} feeBalances={feeBalances} onChanged={load} />}
          {tab === 'overpayments' && <OverpaymentQueue rows={overpayments} onChanged={load} />}
          {tab === 'unified' && <UnifiedFeed students={students} />}
        </>
      )}
    </div>
  );
}

// ── Unmatched queue + match modal ──────────────────────────────────────

function UnmatchedQueue({
  rows, students, feeBalances, onChanged,
}: {
  rows: UnmatchedTxn[];
  students: StudentOption[];
  feeBalances: FeeBalanceOption[];
  onChanged: () => Promise<void>;
}) {
  const [matching, setMatching] = useState<UnmatchedTxn | null>(null);

  if (rows.length === 0) {
    return <div className="rounded-xl border border-dashed border-slate-200 bg-white p-10 text-center text-sm text-slate-400">No unmatched Paybill transactions.</div>;
  }

  return (
    <>
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
            <tr>
              <th className="px-4 py-2 text-left font-medium">M-Pesa receipt</th>
              <th className="px-4 py-2 text-left font-medium">Phone</th>
              <th className="px-4 py-2 text-left font-medium">Bill ref (account no)</th>
              <th className="px-4 py-2 text-right font-medium">Amount</th>
              <th className="px-4 py-2 text-left font-medium">Notes</th>
              <th className="px-4 py-2 text-right font-medium">Date</th>
              <th className="px-4 py-2 text-center font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id} className={`border-t border-slate-100 ${i % 2 ? 'bg-slate-50/40' : ''}`}>
                <td className="px-4 py-2.5 font-mono text-xs">{r.mpesa_receipt_number}</td>
                <td className="px-4 py-2.5 text-slate-600">{r.msisdn}</td>
                <td className="px-4 py-2.5 text-slate-600">{r.bill_reference_number}</td>
                <td className="px-4 py-2.5 text-right font-semibold text-slate-800">{fmt(r.amount, r.currency)}</td>
                <td className="px-4 py-2.5 text-xs text-slate-500 max-w-xs">{r.reconciliation_notes ?? '—'}</td>
                <td className="px-4 py-2.5 text-right text-xs text-slate-400">
                  {new Date(r.created_at).toLocaleString('en-KE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true })}
                </td>
                <td className="px-4 py-2.5 text-center">
                  <button onClick={() => setMatching(r)} className="text-xs px-2 py-1 rounded border border-slate-300 hover:bg-slate-50">
                    Match to student
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {matching && (
        <MatchModal
          txn={matching}
          students={students}
          feeBalances={feeBalances}
          onClose={() => setMatching(null)}
          onMatched={async () => { setMatching(null); await onChanged(); }}
        />
      )}
    </>
  );
}

function MatchModal({
  txn, students, feeBalances, onClose, onMatched,
}: {
  txn: UnmatchedTxn;
  students: StudentOption[];
  feeBalances: FeeBalanceOption[];
  onClose: () => void;
  onMatched: () => Promise<void>;
}) {
  const [query, setQuery] = useState('');
  const [studentId, setStudentId] = useState('');
  const [feeBalanceId, setFeeBalanceId] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return students.slice(0, 20);
    return students.filter((s) =>
      s.admission_no.toLowerCase().includes(q) || s.user.full_name.toLowerCase().includes(q),
    ).slice(0, 20);
  }, [query, students]);

  const balancesForStudent = useMemo(
    () => feeBalances.filter((b) => b.student.id === studentId && Number(b.amount_due) - Number(b.amount_paid) > 0),
    [feeBalances, studentId],
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!studentId) return;
    setSaving(true);
    setError('');
    try {
      await apiFetch(`/payments/paybill/${txn.id}/match`, {
        method: 'POST',
        body: JSON.stringify({ studentId, note: note || undefined, feeBalanceId: feeBalanceId || undefined }),
      });
      await onMatched();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to match transaction');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 px-4" onClick={onClose}>
      <form onSubmit={submit} onClick={(e) => e.stopPropagation()} className="bg-white rounded-xl shadow-xl max-w-md w-full p-5 space-y-4">
        <div>
          <h3 className="text-base font-semibold">Match Paybill payment</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            {fmt(txn.amount, txn.currency)} · ref &quot;{txn.bill_reference_number}&quot; · {txn.msisdn}
          </p>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Student</label>
          <input
            type="text"
            value={studentId ? students.find((s) => s.id === studentId)?.user.full_name ?? '' : query}
            onChange={(e) => { setQuery(e.target.value); setStudentId(''); setFeeBalanceId(''); }}
            placeholder="Search by name or admission no."
            className="block w-full rounded border border-slate-300 px-3 py-2 text-sm"
            autoComplete="off"
          />
          {!studentId && query.trim() && (
            <div className="mt-1 max-h-40 overflow-y-auto border border-slate-200 rounded">
              {matches.length === 0 ? (
                <p className="text-xs text-slate-400 px-3 py-2">No students match.</p>
              ) : matches.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => { setStudentId(s.id); setQuery(''); }}
                  className="block w-full text-left px-3 py-1.5 text-sm hover:bg-slate-50"
                >
                  {s.user.full_name} <span className="text-xs text-slate-400">({s.admission_no})</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {studentId && balancesForStudent.length > 0 && (
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Fee balance (optional — auto-picks the largest outstanding if left blank)</label>
            <select
              value={feeBalanceId}
              onChange={(e) => setFeeBalanceId(e.target.value)}
              className="block w-full rounded border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">Auto-select</option>
              {balancesForStudent.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.term?.name ?? 'No term'} — outstanding {fmt(Number(b.amount_due) - Number(b.amount_paid), b.currency)}
                </option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Note (optional)</label>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Confirmed with parent by phone"
            className="block w-full rounded border border-slate-300 px-3 py-2 text-sm"
          />
        </div>

        {error && <p className="text-sm text-red-600 bg-red-50 rounded px-3 py-2">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="text-sm px-3 py-1.5 rounded border border-slate-300 hover:bg-slate-50">Cancel</button>
          <button type="submit" disabled={!studentId || saving} className="text-sm px-3 py-1.5 rounded bg-slate-900 text-white disabled:opacity-50">
            {saving ? 'Matching…' : 'Match'}
          </button>
        </div>
      </form>
    </div>
  );
}

// ── Overpayment queue ───────────────────────────────────────────────────

function OverpaymentQueue({ rows, onChanged }: { rows: OverpaymentTxn[]; onChanged: () => Promise<void> }) {
  const [resolving, setResolving] = useState<OverpaymentTxn | null>(null);
  const [resolution, setResolution] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function openResolve(txn: OverpaymentTxn) {
    setResolving(txn);
    setResolution('');
    setError('');
  }

  async function submitResolve(e: React.FormEvent) {
    e.preventDefault();
    if (!resolving || !resolution.trim()) return;
    setSaving(true);
    setError('');
    try {
      await apiFetch(`/payments/paybill/${resolving.id}/resolve-overpayment`, {
        method: 'POST',
        body: JSON.stringify({ resolution }),
      });
      setResolving(null);
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to record resolution');
    } finally {
      setSaving(false);
    }
  }

  if (rows.length === 0) {
    return <div className="rounded-xl border border-dashed border-slate-200 bg-white p-10 text-center text-sm text-slate-400">No overpayments awaiting resolution.</div>;
  }

  return (
    <>
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
            <tr>
              <th className="px-4 py-2 text-left font-medium">M-Pesa receipt</th>
              <th className="px-4 py-2 text-left font-medium">Student</th>
              <th className="px-4 py-2 text-right font-medium">Amount</th>
              <th className="px-4 py-2 text-left font-medium">Notes</th>
              <th className="px-4 py-2 text-right font-medium">Date</th>
              <th className="px-4 py-2 text-center font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const resolved = r.reconciliation_notes?.includes(' — Resolved:') ?? false;
              return (
                <tr key={r.id} className={`border-t border-slate-100 ${i % 2 ? 'bg-slate-50/40' : ''}`}>
                  <td className="px-4 py-2.5 font-mono text-xs">{r.mpesa_receipt_number}</td>
                  <td className="px-4 py-2.5">
                    <p className="font-medium text-slate-800">{r.matched_student?.user.full_name ?? '—'}</p>
                    <p className="text-xs text-slate-400">{r.matched_student?.admission_no}</p>
                  </td>
                  <td className="px-4 py-2.5 text-right font-semibold text-slate-800">{fmt(r.amount, r.currency)}</td>
                  <td className="px-4 py-2.5 text-xs text-slate-500 max-w-xs">{r.reconciliation_notes ?? '—'}</td>
                  <td className="px-4 py-2.5 text-right text-xs text-slate-400">
                    {new Date(r.created_at).toLocaleString('en-KE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true })}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    {resolved ? (
                      <span className="text-xs text-emerald-600 font-medium">Resolved</span>
                    ) : (
                      <button onClick={() => openResolve(r)} className="text-xs px-2 py-1 rounded border border-slate-300 hover:bg-slate-50">
                        Record resolution
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {resolving && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 px-4" onClick={() => setResolving(null)}>
          <form onSubmit={submitResolve} onClick={(e) => e.stopPropagation()} className="bg-white rounded-xl shadow-xl max-w-md w-full p-5 space-y-4">
            <div>
              <h3 className="text-base font-semibold">Resolve overpayment</h3>
              <p className="text-xs text-slate-500 mt-0.5">{fmt(resolving.amount, resolving.currency)} — {resolving.matched_student?.user.full_name}</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">How was this resolved?</label>
              <input
                type="text"
                value={resolution}
                onChange={(e) => setResolution(e.target.value)}
                placeholder="e.g. Credited to next term's balance"
                required
                className="block w-full rounded border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            {error && <p className="text-sm text-red-600 bg-red-50 rounded px-3 py-2">{error}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => setResolving(null)} className="text-sm px-3 py-1.5 rounded border border-slate-300 hover:bg-slate-50">Cancel</button>
              <button type="submit" disabled={!resolution.trim() || saving} className="text-sm px-3 py-1.5 rounded bg-slate-900 text-white disabled:opacity-50">
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}

// ── Unified read-only feed across all three payment tables ─────────────
// Deliberately visibility-only: no cross-table edits, no on-the-fly
// normalization. It exists to make the payment_records /
// payment_transactions / payment_paybill_transactions fragmentation
// visible, not to fix it.

function UnifiedFeed({ students }: { students: StudentOption[] }) {
  const [rows, setRows] = useState<UnifiedRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [studentId, setStudentId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [source, setSource] = useState<'all' | 'manual' | 'paystack' | 'paybill'>('all');

  const load = useCallback(async (filters: { studentId?: string; from?: string; to?: string }) => {
    setLoading(true);
    setError('');
    try {
      const qs = new URLSearchParams();
      if (filters.studentId) qs.set('studentId', filters.studentId);
      if (filters.from) qs.set('from', filters.from);
      if (filters.to) qs.set('to', filters.to);
      const q = qs.toString();
      const data = await apiFetch<UnifiedRow[]>(`/payments/unified${q ? `?${q}` : ''}`);
      setRows(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load unified feed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load({}); }, [load]);

  const filtered = source === 'all' ? rows : rows.filter((r) => r.source === source);

  return (
    <div className="space-y-3">
      <form
        onSubmit={(e) => { e.preventDefault(); load({ studentId: studentId || undefined, from: from || undefined, to: to || undefined }); }}
        className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap gap-3 items-end"
      >
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Student</label>
          <select value={studentId} onChange={(e) => setStudentId(e.target.value)} className="rounded border border-slate-300 px-2 py-1.5 text-sm min-w-[10rem]">
            <option value="">All students</option>
            {students.map((s) => <option key={s.id} value={s.id}>{s.user.full_name} ({s.admission_no})</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">From</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded border border-slate-300 px-2 py-1.5 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">To</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded border border-slate-300 px-2 py-1.5 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Source</label>
          <select value={source} onChange={(e) => setSource(e.target.value as typeof source)} className="rounded border border-slate-300 px-2 py-1.5 text-sm">
            <option value="all">All sources</option>
            <option value="manual">Manual</option>
            <option value="paystack">Paystack</option>
            <option value="paybill">Paybill</option>
          </select>
        </div>
        <button type="submit" className="text-sm px-3 py-1.5 rounded bg-slate-900 text-white">Apply</button>
      </form>

      {error && <p className="text-sm text-red-600 bg-red-50 rounded px-3 py-2">{error}</p>}

      {loading ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-white p-10 text-center text-sm text-slate-400">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-white p-10 text-center text-sm text-slate-400">No payments match these filters.</div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Source</th>
                <th className="px-4 py-2 text-left font-medium">Student</th>
                <th className="px-4 py-2 text-left font-medium">Reference</th>
                <th className="px-4 py-2 text-right font-medium">Amount</th>
                <th className="px-4 py-2 text-center font-medium">Status</th>
                <th className="px-4 py-2 text-right font-medium">Date</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => (
                <tr key={`${r.source}-${r.id}`} className={`border-t border-slate-100 ${i % 2 ? 'bg-slate-50/40' : ''}`}>
                  <td className="px-4 py-2.5">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${SOURCE_STYLE[r.source]}`}>{r.source}</span>
                  </td>
                  <td className="px-4 py-2.5">
                    <p className="font-medium text-slate-800">{r.studentName ?? '—'}</p>
                    <p className="text-xs text-slate-400">{r.admissionNo ?? '—'}</p>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-slate-500 font-mono">{r.reference ?? '—'}</td>
                  <td className="px-4 py-2.5 text-right font-semibold text-slate-800">{fmt(r.amount, r.currency)}</td>
                  <td className="px-4 py-2.5 text-center text-xs text-slate-500">{r.status}</td>
                  <td className="px-4 py-2.5 text-right text-xs text-slate-400">
                    {new Date(r.createdAt).toLocaleString('en-KE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true })}
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
