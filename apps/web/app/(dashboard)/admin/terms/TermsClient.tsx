'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { CreateTermInput } from '@school-manager/types';

type TermRow = { id: string; name: string; start_date: string; end_date: string; is_current: boolean };

export default function TermsClient({ initialTerms }: { initialTerms: TermRow[] }) {
  const router = useRouter();
  const [terms, setTerms] = useState(initialTerms);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [isCurrent, setIsCurrent] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const result = CreateTermInput.safeParse({ name, startDate, endDate, isCurrent });
    if (!result.success) { setError(result.error.issues[0]?.message ?? 'Invalid'); return; }

    setLoading(true);
    try {
      const created = await apiFetch<TermRow>('/terms', {
        method: 'POST',
        body: JSON.stringify(result.data),
      });
      setTerms((prev) => {
        const updated = isCurrent ? prev.map((t) => ({ ...t, is_current: false })) : prev;
        return [created, ...updated];
      });
      setShowForm(false); setName(''); setStartDate(''); setEndDate(''); setIsCurrent(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally { setLoading(false); }
  }

  async function handleSetCurrent(id: string) {
    try {
      await apiFetch(`/terms/${id}/set-current`, { method: 'PATCH' });
      setTerms((prev) => prev.map((t) => ({ ...t, is_current: t.id === id })));
      router.refresh();
    } catch (err) { alert(err instanceof Error ? err.message : 'Failed'); }
  }

  return (
    <div className="space-y-4">
      <button onClick={() => setShowForm((v) => !v)}
        className="bg-slate-900 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-slate-700">
        {showForm ? 'Cancel' : '+ Add term'}
      </button>

      {showForm && (
        <form onSubmit={handleCreate} className="bg-white border border-slate-200 rounded-lg p-5 space-y-4 max-w-md">
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div>
            <label className="block text-sm font-medium text-slate-700">Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="Term 2 2026"
              className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700">Start date</label>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required
                className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700">End date</label>
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} required
                className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={isCurrent} onChange={(e) => setIsCurrent(e.target.checked)}
              className="rounded" />
            Set as current term
          </label>
          <button type="submit" disabled={loading}
            className="bg-slate-900 text-white px-4 py-2 rounded-md text-sm disabled:opacity-50">
            {loading ? 'Creating…' : 'Create term'}
          </button>
        </form>
      )}

      {terms.length === 0 ? (
        <p className="text-sm text-slate-500">No terms yet.</p>
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg divide-y divide-slate-100">
          {terms.map((t) => (
            <div key={t.id} className="flex items-center justify-between px-5 py-3">
              <div>
                <p className="font-medium text-sm flex items-center gap-2">
                  {t.name}
                  {t.is_current && (
                    <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded">current</span>
                  )}
                </p>
                <p className="text-xs text-slate-500">{t.start_date} → {t.end_date}</p>
              </div>
              {!t.is_current && (
                <button onClick={() => handleSetCurrent(t.id)}
                  className="text-xs text-slate-400 hover:text-slate-900 transition-colors">
                  Set current
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
