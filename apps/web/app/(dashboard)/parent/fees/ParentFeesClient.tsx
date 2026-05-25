'use client';

import { useState } from 'react';
import { apiFetch } from '@/lib/api';

type Balance = {
  id: string;
  student_id: string;
  amount_due: number;
  amount_paid: number;
  currency: string;
  notes: string | null;
  as_of_date: string;
  term: { name: string } | null;
};

type StudentInfo = {
  id: string;
  admission_no: string;
  user: { full_name: string };
};

type PaymentRecord = {
  id: string;
  amount: number;
  payment_method: string;
  reference_no: string | null;
  paid_date: string;
  notes: string | null;
  created_at: string;
  recorded_by: { full_name: string } | null;
};

const METHOD_LABEL: Record<string, string> = {
  cash: 'Cash',
  bank_transfer: 'Bank Transfer',
  mpesa: 'M-Pesa',
  cheque: 'Cheque',
  other: 'Other',
};

export default function ParentFeesClient({
  balances,
  studentMap,
  totalDue,
  totalPaid,
  currency,
}: {
  balances: Balance[];
  studentMap: Record<string, StudentInfo>;
  totalDue: number;
  totalPaid: number;
  currency: string;
}) {
  const totalOutstanding = totalDue - totalPaid;

  const [history, setHistory] = useState<Record<string, PaymentRecord[]>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [loadingId, setLoadingId] = useState<string | null>(null);

  async function toggleHistory(balanceId: string) {
    if (expanded[balanceId]) {
      setExpanded((prev) => ({ ...prev, [balanceId]: false }));
      return;
    }
    if (history[balanceId]) {
      setExpanded((prev) => ({ ...prev, [balanceId]: true }));
      return;
    }
    setLoadingId(balanceId);
    try {
      const records = await apiFetch<PaymentRecord[]>(`/fees/${balanceId}/payments`);
      setHistory((prev) => ({ ...prev, [balanceId]: records }));
      setExpanded((prev) => ({ ...prev, [balanceId]: true }));
    } catch {
      // silently fail — button will still toggle off
    } finally {
      setLoadingId(null);
    }
  }

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className={`rounded-xl p-5 ${totalOutstanding > 0 ? 'bg-amber-50 border border-amber-200' : 'bg-emerald-50 border border-emerald-200'}`}>
          <p className={`text-3xl font-bold ${totalOutstanding > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>
            {currency} {totalOutstanding.toLocaleString()}
          </p>
          <p className={`text-sm mt-1 ${totalOutstanding > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
            {totalOutstanding > 0 ? 'Outstanding' : 'All paid'}
          </p>
        </div>
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-5">
          <p className="text-3xl font-bold text-slate-700">{currency} {totalDue.toLocaleString()}</p>
          <p className="text-sm text-slate-500 mt-1">Total billed</p>
        </div>
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-5">
          <p className="text-3xl font-bold text-emerald-700">{currency} {totalPaid.toLocaleString()}</p>
          <p className="text-sm text-emerald-600 mt-1">Total paid</p>
        </div>
      </div>

      {/* Balance records */}
      {balances.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl px-5 py-10 text-center text-sm text-slate-400">
          No fee records on file.
        </div>
      ) : (
        <div className="space-y-3">
          {balances.map((b) => {
            const outstanding = Number(b.amount_due) - Number(b.amount_paid);
            const student = studentMap[b.student_id];
            const paidPct = Number(b.amount_due) > 0
              ? Math.min(100, (Number(b.amount_paid) / Number(b.amount_due)) * 100)
              : 0;
            const isExpanded = expanded[b.id];
            const payments = history[b.id] ?? [];

            return (
              <div
                key={b.id}
                className={`bg-white rounded-xl border shadow-sm overflow-hidden ${
                  outstanding > 0 ? 'border-amber-200' : 'border-emerald-200'
                }`}
              >
                {/* Card header */}
                <div className={`px-5 py-3 flex items-center justify-between ${
                  outstanding > 0 ? 'bg-amber-50' : 'bg-emerald-50'
                }`}>
                  <div>
                    <p className="font-semibold text-slate-800">{student?.user?.full_name}</p>
                    <p className="text-xs text-slate-500">{b.term?.name ?? 'General'}</p>
                  </div>
                  <p className={`text-lg font-bold ${outstanding > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>
                    {outstanding > 0 ? `${b.currency} ${outstanding.toLocaleString()} due` : 'Paid'}
                  </p>
                </div>

                {/* Amounts */}
                <div className="px-5 py-3 grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-xs text-slate-400">Amount billed</p>
                    <p className="font-medium">{b.currency} {Number(b.amount_due).toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">Amount paid</p>
                    <p className="font-medium text-emerald-600">{b.currency} {Number(b.amount_paid).toLocaleString()}</p>
                  </div>
                  {b.notes && (
                    <div className="col-span-2">
                      <p className="text-xs text-slate-400">Note</p>
                      <p className="text-slate-600">{b.notes}</p>
                    </div>
                  )}
                </div>

                {/* Progress bar */}
                <div className="px-5 pb-3">
                  <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${paidPct}%` }} />
                  </div>
                </div>

                {/* Payment history toggle */}
                <div className="px-5 pb-3 border-t border-slate-100 pt-3">
                  <button
                    onClick={() => toggleHistory(b.id)}
                    disabled={loadingId === b.id}
                    className="text-xs font-medium text-slate-500 hover:text-slate-800 transition-colors disabled:opacity-50"
                  >
                    {loadingId === b.id
                      ? 'Loading…'
                      : isExpanded
                      ? '▲ Hide payments'
                      : '▼ View payment history'}
                  </button>

                  {isExpanded && (
                    <div className="mt-3">
                      {payments.length === 0 ? (
                        <p className="text-xs text-slate-400">No payments recorded yet.</p>
                      ) : (
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-slate-400 border-b border-slate-100">
                              <th className="text-left pb-1 font-medium">Date</th>
                              <th className="text-left pb-1 font-medium">Method</th>
                              <th className="text-right pb-1 font-medium">Amount</th>
                              <th className="text-left pb-1 font-medium hidden sm:table-cell">Reference</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-50">
                            {payments.map((p) => (
                              <tr key={p.id}>
                                <td className="py-1.5 text-slate-600">
                                  {new Date(p.paid_date).toLocaleDateString()}
                                </td>
                                <td className="py-1.5 text-slate-600">
                                  {METHOD_LABEL[p.payment_method] ?? p.payment_method}
                                </td>
                                <td className="py-1.5 text-right font-medium text-emerald-700">
                                  {b.currency} {Number(p.amount).toLocaleString()}
                                </td>
                                <td className="py-1.5 text-slate-400 hidden sm:table-cell">
                                  {p.reference_no ?? '—'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
