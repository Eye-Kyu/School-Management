'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { PAYMENT_METHODS } from '@school-manager/types';
import posthog from 'posthog-js';

type Balance = {
  id: string;
  amount_due: number;
  amount_paid: number;
  currency: string;
  notes: string | null;
  as_of_date: string;
  student: { admission_no: string; user: { full_name: string } };
  term: { name: string } | null;
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

const SAMPLE_CSV = `admissionNo,amountDue,amountPaid,termName,notes
ADM001,12500,5000,Term 1 2026,
ADM002,8000,0,,School bus`;

const METHOD_LABEL: Record<string, string> = {
  cash: 'Cash', bank_transfer: 'Bank Transfer', mpesa: 'M-Pesa', cheque: 'Cheque', other: 'Other',
};

export default function FeesClient({ balances }: { balances: Balance[] }) {
  const router = useRouter();

  // Import state
  const [showImport, setShowImport] = useState(false);
  const [csv, setCsv] = useState('');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ imported: number; failed: number; rows: any[] } | null>(null);
  const [importError, setImportError] = useState('');

  // Per-row payment recording state
  const [paymentRow, setPaymentRow] = useState<string | null>(null); // balanceId being edited
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<string>('cash');
  const [referenceNo, setReferenceNo] = useState('');
  const [paidDate, setPaidDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [paymentNotes, setPaymentNotes] = useState('');
  const [savingPayment, setSavingPayment] = useState(false);
  const [paymentError, setPaymentError] = useState('');

  // Per-row history state
  const [historyRow, setHistoryRow] = useState<string | null>(null);
  const [history, setHistory] = useState<PaymentRecord[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  async function handleImport(e: React.FormEvent) {
    e.preventDefault();
    if (!csv.trim()) return;
    setImporting(true);
    setImportError('');
    setImportResult(null);
    try {
      const res = await apiFetch<{ imported: number; failed: number; rows: any[] }>(
        '/fees/import',
        { method: 'POST', body: JSON.stringify({ csv }) },
      );
      setImportResult(res);
      if (res.imported > 0) {
        posthog.capture('fees_csv_imported', { imported_count: res.imported, failed_count: res.failed });
        router.refresh(); setCsv('');
      }
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setImporting(false);
    }
  }

  function openPaymentForm(balanceId: string) {
    setPaymentRow(balanceId);
    setAmount('');
    setMethod('cash');
    setReferenceNo('');
    setPaidDate(new Date().toISOString().slice(0, 10));
    setPaymentNotes('');
    setPaymentError('');
    setHistoryRow(null);
  }

  async function handleRecordPayment(e: React.FormEvent, balanceId: string) {
    e.preventDefault();
    if (!amount) return;
    setSavingPayment(true);
    setPaymentError('');
    try {
      await apiFetch('/fees/payments', {
        method: 'POST',
        body: JSON.stringify({
          feeBalanceId: balanceId,
          amount,
          paymentMethod: method,
          referenceNo: referenceNo || undefined,
          paidDate,
          notes: paymentNotes || undefined,
        }),
      });
      posthog.capture('fee_payment_recorded', { payment_method: method });
      setPaymentRow(null);
      router.refresh();
    } catch (err) {
      setPaymentError(err instanceof Error ? err.message : 'Failed to record payment');
    } finally {
      setSavingPayment(false);
    }
  }

  async function toggleHistory(balanceId: string) {
    if (historyRow === balanceId) { setHistoryRow(null); return; }
    setHistoryRow(balanceId);
    setPaymentRow(null);
    setLoadingHistory(true);
    try {
      const data = await apiFetch<PaymentRecord[]>(`/fees/${balanceId}/payments`);
      setHistory(data);
    } catch {
      setHistory([]);
    } finally {
      setLoadingHistory(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* Import section */}
      <div>
        <button
          onClick={() => { setShowImport((v) => !v); setImportResult(null); setImportError(''); }}
          className="bg-slate-900 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-slate-700"
        >
          {showImport ? 'Cancel' : '↑ Import CSV'}
        </button>
      </div>

      {showImport && (
        <form onSubmit={handleImport} className="bg-white border border-slate-200 rounded-lg p-5 space-y-4 max-w-2xl">
          <div>
            <p className="text-sm font-medium mb-1">CSV format</p>
            <pre className="text-xs bg-slate-50 border border-slate-200 rounded px-3 py-2 whitespace-pre-wrap">
              {SAMPLE_CSV}
            </pre>
            <p className="text-xs text-slate-400 mt-1">
              Required: admissionNo, amountDue. Optional: amountPaid (default 0), termName, notes.
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
            <div className="text-sm">
              <p className="text-green-700">Imported {importResult.imported} row{importResult.imported !== 1 ? 's' : ''}.</p>
              {importResult.failed > 0 && (
                <div className="mt-2 space-y-1">
                  {importResult.rows.filter((r) => r.result === 'error').map((r) => (
                    <p key={r.row} className="text-red-600 text-xs">Row {r.row}: {r.message}</p>
                  ))}
                </div>
              )}
            </div>
          )}
          <button type="submit" disabled={importing}
            className="bg-slate-900 text-white px-4 py-2 rounded text-sm disabled:opacity-50">
            {importing ? 'Importing…' : 'Import'}
          </button>
        </form>
      )}

      {/* Balances table */}
      {balances.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-lg px-5 py-10 text-center text-sm text-slate-400">
          No fee balances yet. Import a CSV to get started.
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-medium text-slate-500">Student</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-slate-500">Adm No</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-slate-500">Term</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-slate-500">Amount Due</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-slate-500">Amount Paid</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-slate-500">Outstanding</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-slate-500">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {balances.map((b) => {
                const outstanding = Number(b.amount_due) - Number(b.amount_paid);
                const isPaymentOpen = paymentRow === b.id;
                const isHistoryOpen = historyRow === b.id;
                return (
                  <>
                    <tr key={b.id} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5 font-medium">{b.student?.user?.full_name}</td>
                      <td className="px-4 py-2.5 text-slate-500 text-xs">{b.student?.admission_no}</td>
                      <td className="px-4 py-2.5 text-slate-500">{b.term?.name ?? '—'}</td>
                      <td className="px-4 py-2.5 text-right">{b.currency} {Number(b.amount_due).toLocaleString()}</td>
                      <td className="px-4 py-2.5 text-right">{b.currency} {Number(b.amount_paid).toLocaleString()}</td>
                      <td className={`px-4 py-2.5 text-right font-medium ${outstanding > 0 ? 'text-red-600' : 'text-green-600'}`}>
                        {b.currency} {outstanding.toLocaleString()}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => isPaymentOpen ? setPaymentRow(null) : openPaymentForm(b.id)}
                            className="text-xs px-2 py-1 rounded border border-slate-300 hover:bg-slate-50"
                          >
                            {isPaymentOpen ? 'Cancel' : '+ Payment'}
                          </button>
                          <button
                            onClick={() => toggleHistory(b.id)}
                            className="text-xs px-2 py-1 rounded border border-slate-300 hover:bg-slate-50"
                          >
                            {isHistoryOpen ? 'Hide' : 'History'}
                          </button>
                        </div>
                      </td>
                    </tr>

                    {/* Record payment inline form */}
                    {isPaymentOpen && (
                      <tr key={`${b.id}-payment`}>
                        <td colSpan={7} className="px-4 py-4 bg-slate-50 border-b border-slate-100">
                          <form onSubmit={(e) => handleRecordPayment(e, b.id)} className="flex flex-wrap gap-3 items-end">
                            <div>
                              <label className="block text-xs font-medium text-slate-600 mb-1">Amount ({b.currency})</label>
                              <input
                                type="text"
                                value={amount}
                                onChange={(e) => setAmount(e.target.value)}
                                placeholder="5000"
                                required
                                className="w-32 rounded border border-slate-300 px-2 py-1.5 text-sm"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-slate-600 mb-1">Method</label>
                              <select
                                value={method}
                                onChange={(e) => setMethod(e.target.value)}
                                className="rounded border border-slate-300 px-2 py-1.5 text-sm"
                              >
                                {PAYMENT_METHODS.map((m) => (
                                  <option key={m} value={m}>{METHOD_LABEL[m]}</option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-slate-600 mb-1">Reference No</label>
                              <input
                                type="text"
                                value={referenceNo}
                                onChange={(e) => setReferenceNo(e.target.value)}
                                placeholder="e.g. QFJ7X3K2"
                                className="w-36 rounded border border-slate-300 px-2 py-1.5 text-sm"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-slate-600 mb-1">Date</label>
                              <input
                                type="date"
                                value={paidDate}
                                onChange={(e) => setPaidDate(e.target.value)}
                                required
                                className="rounded border border-slate-300 px-2 py-1.5 text-sm"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-slate-600 mb-1">Notes</label>
                              <input
                                type="text"
                                value={paymentNotes}
                                onChange={(e) => setPaymentNotes(e.target.value)}
                                placeholder="Optional"
                                className="w-40 rounded border border-slate-300 px-2 py-1.5 text-sm"
                              />
                            </div>
                            <button
                              type="submit"
                              disabled={savingPayment}
                              className="bg-slate-900 text-white px-3 py-1.5 rounded text-sm disabled:opacity-50"
                            >
                              {savingPayment ? 'Saving…' : 'Record'}
                            </button>
                            {paymentError && (
                              <p className="w-full text-xs text-red-600">{paymentError}</p>
                            )}
                          </form>
                        </td>
                      </tr>
                    )}

                    {/* Payment history */}
                    {isHistoryOpen && (
                      <tr key={`${b.id}-history`}>
                        <td colSpan={7} className="px-4 py-3 bg-slate-50 border-b border-slate-100">
                          {loadingHistory ? (
                            <p className="text-xs text-slate-400">Loading…</p>
                          ) : history.length === 0 ? (
                            <p className="text-xs text-slate-400">No payments recorded yet.</p>
                          ) : (
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="text-slate-500">
                                  <th className="text-left pb-1 pr-4">Date</th>
                                  <th className="text-right pb-1 pr-4">Amount</th>
                                  <th className="text-left pb-1 pr-4">Method</th>
                                  <th className="text-left pb-1 pr-4">Reference</th>
                                  <th className="text-left pb-1 pr-4">Recorded by</th>
                                  <th className="text-left pb-1">Notes</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100">
                                {history.map((p) => (
                                  <tr key={p.id}>
                                    <td className="py-1 pr-4">{p.paid_date}</td>
                                    <td className="py-1 pr-4 text-right">{b.currency} {Number(p.amount).toLocaleString()}</td>
                                    <td className="py-1 pr-4">{METHOD_LABEL[p.payment_method] ?? p.payment_method}</td>
                                    <td className="py-1 pr-4 text-slate-400">{p.reference_no ?? '—'}</td>
                                    <td className="py-1 pr-4">{(p.recorded_by as any)?.full_name ?? '—'}</td>
                                    <td className="py-1 text-slate-400">{p.notes ?? '—'}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
