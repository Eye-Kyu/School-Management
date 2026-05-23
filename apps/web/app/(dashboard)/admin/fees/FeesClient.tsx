'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';

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

const SAMPLE_CSV = `admissionNo,amountDue,amountPaid,termName,notes
ADM001,12500,5000,Term 1 2026,
ADM002,8000,0,,School bus`;

export default function FeesClient({ balances }: { balances: Balance[] }) {
  const router = useRouter();
  const [showImport, setShowImport] = useState(false);
  const [csv, setCsv] = useState('');
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ imported: number; failed: number; rows: any[] } | null>(null);
  const [error, setError] = useState('');

  async function handleImport(e: React.FormEvent) {
    e.preventDefault();
    if (!csv.trim()) return;
    setImporting(true);
    setError('');
    setResult(null);

    try {
      const res = await apiFetch<{ imported: number; failed: number; rows: any[] }>(
        '/fees/import',
        { method: 'POST', body: JSON.stringify({ csv }) },
      );
      setResult(res);
      if (res.imported > 0) {
        router.refresh();
        setCsv('');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* Import section */}
      <div>
        <button
          onClick={() => { setShowImport((v) => !v); setResult(null); setError(''); }}
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
              Required columns: admissionNo, amountDue. Optional: amountPaid (default 0), termName, notes.
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
          {error && <p className="text-sm text-red-600 bg-red-50 rounded px-3 py-2">{error}</p>}
          {result && (
            <div className="text-sm">
              <p className="text-green-700">Imported {result.imported} row{result.imported !== 1 ? 's' : ''}.</p>
              {result.failed > 0 && (
                <div className="mt-2 space-y-1">
                  {result.rows.filter((r) => r.result === 'error').map((r) => (
                    <p key={r.row} className="text-red-600 text-xs">Row {r.row}: {r.message}</p>
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
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {balances.map((b: any) => {
                const outstanding = Number(b.amount_due) - Number(b.amount_paid);
                return (
                  <tr key={b.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5 font-medium">{b.student?.user?.full_name}</td>
                    <td className="px-4 py-2.5 text-slate-500 text-xs">{b.student?.admission_no}</td>
                    <td className="px-4 py-2.5 text-slate-500">{b.term?.name ?? '—'}</td>
                    <td className="px-4 py-2.5 text-right">{b.currency} {Number(b.amount_due).toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-right">{b.currency} {Number(b.amount_paid).toLocaleString()}</td>
                    <td className={`px-4 py-2.5 text-right font-medium ${outstanding > 0 ? 'text-red-600' : 'text-green-600'}`}>
                      {b.currency} {outstanding.toLocaleString()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
