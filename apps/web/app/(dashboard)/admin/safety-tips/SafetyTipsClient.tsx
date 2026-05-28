'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

type Tip = { id: string; message: string; status: string; created_at: string };

export default function SafetyTipsClient({ tips: initial }: { tips: Tip[] }) {
  const supabase = createClient();
  const [tips, setTips] = useState(initial);
  const [filter, setFilter] = useState<'ALL' | 'NEW' | 'REVIEWED'>('NEW');

  async function updateStatus(id: string, status: string) {
    await supabase.from('safety_tips').update({ status, reviewed_at: new Date().toISOString() }).eq('id', id);
    setTips((p) => p.map((t) => t.id === id ? { ...t, status } : t));
  }

  const filtered = tips.filter((t) => filter === 'ALL' || t.status === filter);
  const newCount = tips.filter((t) => t.status === 'NEW').length;

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {(['ALL', 'NEW', 'REVIEWED'] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className={`text-sm px-3 py-1 rounded-full font-medium transition-colors ${filter === f ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
            {f}{f === 'NEW' && newCount > 0 ? ` (${newCount})` : ''}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-white p-10 text-center text-sm text-slate-400">
          {filter === 'NEW' ? 'No new reports.' : 'No reports found.'}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((t) => (
            <div key={t.id} className={`bg-white border rounded-xl p-5 space-y-3 ${t.status === 'NEW' ? 'border-amber-200' : 'border-slate-200'}`}>
              <div className="flex items-start justify-between gap-3">
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full shrink-0 ${
                  t.status === 'NEW' ? 'bg-amber-100 text-amber-700' :
                  t.status === 'REVIEWED' ? 'bg-blue-100 text-blue-700' : 'bg-emerald-100 text-emerald-700'
                }`}>{t.status}</span>
                <span className="text-xs text-slate-400">{new Date(t.created_at).toLocaleString('en-KE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true })}</span>
              </div>
              <p className="text-sm text-slate-800 whitespace-pre-wrap">{t.message}</p>
              {t.status === 'NEW' && (
                <div className="flex gap-2">
                  <button onClick={() => updateStatus(t.id, 'REVIEWED')}
                    className="px-3 py-1.5 rounded-lg text-sm border border-slate-200 text-slate-600 hover:bg-slate-50">
                    Mark reviewed
                  </button>
                  <button onClick={() => updateStatus(t.id, 'ACTIONED')}
                    className="px-3 py-1.5 rounded-lg text-sm bg-emerald-600 text-white hover:bg-emerald-500">
                    Mark actioned
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
