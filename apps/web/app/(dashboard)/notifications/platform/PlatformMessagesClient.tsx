'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

type Row = {
  recipientId: string;
  subject: string;
  body: string;
  sentAt: string;
  readAt: string | null;
  dismissedAt: string | null;
};

export default function PlatformMessagesClient({ initialRows }: { initialRows: Row[] }) {
  const supabase = createClient();
  const [rows, setRows] = useState(initialRows);

  // Mark visible unread messages as read after 3 seconds — no per-item audit
  // log entry (read_at itself is the record; too noisy to log individually).
  useEffect(() => {
    const unreadIds = initialRows.filter((r) => !r.readAt).map((r) => r.recipientId);
    if (unreadIds.length === 0) return;
    const t = setTimeout(() => {
      supabase.from('platform_message_recipients')
        .update({ read_at: new Date().toISOString() })
        .in('id', unreadIds)
        .then(() => {
          setRows((prev) => prev.map((r) => unreadIds.includes(r.recipientId) ? { ...r, readAt: r.readAt ?? new Date().toISOString() } : r));
        });
    }, 3000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function dismiss(recipientId: string) {
    setRows((prev) => prev.map((r) => r.recipientId === recipientId ? { ...r, dismissedAt: new Date().toISOString() } : r));
    await supabase.from('platform_message_recipients')
      .update({ dismissed_at: new Date().toISOString() })
      .eq('id', recipientId);
  }

  const visible = rows.filter((r) => !r.dismissedAt);

  if (visible.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center text-slate-400 text-sm">
        No platform messages.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {visible.map((r) => (
        <div key={r.recipientId}
          className={`rounded-lg border bg-white px-4 py-3 ${r.readAt ? 'border-slate-200' : 'border-violet-200 bg-violet-50/40'}`}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-violet-600 bg-violet-100 px-1.5 py-0.5 rounded">
                  From platform team
                </span>
                {!r.readAt && <span className="h-2 w-2 rounded-full bg-violet-500" />}
              </div>
              <p className="text-sm font-medium text-slate-800 mt-1">{r.subject}</p>
              <p className="text-sm text-slate-600 mt-0.5 whitespace-pre-wrap">{r.body}</p>
              <p className="text-xs text-slate-400 mt-1">{new Date(r.sentAt).toLocaleString()}</p>
            </div>
            <button onClick={() => dismiss(r.recipientId)}
              className="text-xs text-slate-400 hover:text-slate-700 shrink-0">
              Dismiss
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
