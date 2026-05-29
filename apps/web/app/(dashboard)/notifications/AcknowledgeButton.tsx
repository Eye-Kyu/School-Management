'use client';

import { useState } from 'react';
import { apiFetch } from '@/lib/api';

export default function AcknowledgeButton({ id }: { id: string }) {
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  if (done) {
    return <span className="text-xs text-emerald-600 font-medium">✓ Acknowledged</span>;
  }

  return (
    <button
      onClick={async () => {
        setLoading(true);
        await apiFetch(`/notifications/${id}/acknowledge`, { method: 'PATCH' }).catch(() => {});
        setDone(true);
        setLoading(false);
      }}
      disabled={loading}
      className="text-xs border border-slate-300 text-slate-600 px-2.5 py-1 rounded-lg hover:bg-slate-50 transition-colors disabled:opacity-50"
    >
      {loading ? '…' : 'Acknowledge'}
    </button>
  );
}
