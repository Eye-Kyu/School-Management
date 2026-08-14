'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { DASHBOARD_FEED_QUERY_KEY, DASHBOARD_FEED_UNREAD_COUNT_QUERY_KEY } from '@/lib/hooks/useDashboardFeed';

export default function AcknowledgeButton({ id }: { id: string }) {
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const queryClient = useQueryClient();

  if (done) {
    return <span className="text-xs text-emerald-600 font-medium">✓ Acknowledged</span>;
  }

  return (
    <button
      onClick={async () => {
        setLoading(true);
        await apiFetch(`/notifications/${id}/acknowledge`, { method: 'PATCH' }).catch(() => {});
        // Bug 2 fix (exploration-bugs Phase 1 audit): acknowledge() writes
        // both acknowledged_at and is_read on the backend — a different
        // write than the shared markRead endpoint's is_read-only update —
        // so this can't just switch to useMarkFeedItemsRead without losing
        // the acknowledged_at persistence. Still needs to invalidate the
        // same shared feed/unread-count cache the badge reads from, which
        // this call never did before.
        queryClient.invalidateQueries({ queryKey: DASHBOARD_FEED_QUERY_KEY });
        queryClient.invalidateQueries({ queryKey: DASHBOARD_FEED_UNREAD_COUNT_QUERY_KEY });
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
