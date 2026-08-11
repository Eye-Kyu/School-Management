'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';

type ConfigurationOverview = {
  notificationSenderEmail: string;
  notificationSenderName: string;
  appUrl: string;
  webhookSecretConfigured: boolean;
};

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between px-5 py-3">
      <span className="text-sm text-slate-500">{label}</span>
      <span className="text-sm font-medium text-slate-800">{value}</span>
    </div>
  );
}

// Moved verbatim from the old standalone Platform Settings page (Bucket 1,
// PR 1) — same content, same read-only framing, now a tab instead of its
// own route.
export default function ConfigurationTab() {
  const [overview, setOverview] = useState<ConfigurationOverview | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    apiFetch<ConfigurationOverview>('/super-admin/system-health/configuration')
      .then(setOverview)
      .catch((e) => setErr(e instanceof Error ? e.message : 'Failed to load platform configuration'));
  }, []);

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">
        Platform configuration — read-only. These are deployment environment variables, not database rows;
        changing them requires a redeploy, not a form here.
      </p>

      {err && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{err}</p>}

      {!overview ? (
        <p className="text-sm text-slate-400 text-center py-10">Loading…</p>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
          <Row label="Notification sender email" value={overview.notificationSenderEmail} />
          <Row label="Notification sender name" value={overview.notificationSenderName} />
          <Row label="App URL" value={overview.appUrl} />
          <Row label="Webhook HMAC secret" value={overview.webhookSecretConfigured ? '•••••••••••••• (configured)' : 'Not set'} />
        </div>
      )}
    </div>
  );
}
