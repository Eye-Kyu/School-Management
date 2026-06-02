'use client';

import { useState } from 'react';
import { apiFetch } from '@/lib/api';

export default function EmailReportCardButton({
  studentId, termId, reportCardUrl,
}: {
  studentId: string;
  termId: string;
  reportCardUrl: string;
}) {
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

  async function send() {
    setState('sending');
    try {
      const { sent } = await apiFetch<{ sent: number }>('/notifications/report-card-email', {
        method: 'POST',
        body: JSON.stringify({ studentId, termId, reportCardUrl }),
      });
      setState(sent > 0 ? 'sent' : 'error');
    } catch {
      setState('error');
    }
  }

  if (state === 'sent') return <span className="text-xs text-emerald-600 font-medium">✓ Emailed</span>;
  if (state === 'error') return <span className="text-xs text-rose-500">Failed</span>;

  return (
    <button
      onClick={send}
      disabled={state === 'sending'}
      className="text-xs border border-violet-200 text-violet-700 bg-violet-50 px-3 py-1 rounded-lg hover:bg-violet-100 disabled:opacity-50"
    >
      {state === 'sending' ? 'Sending…' : '✉ Email parents'}
    </button>
  );
}
