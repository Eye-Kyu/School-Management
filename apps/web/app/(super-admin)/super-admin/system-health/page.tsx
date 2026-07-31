'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { usePlatformPermissions } from '@/lib/hooks/usePlatformPermissions';
import StatCard from '../../StatCard';
import ConfigurationTab from './ConfigurationTab';

type Overview = {
  api: { status: 'OK'; version: string; timestamp: string };
  database: { status: 'OK' | 'DOWN'; latencyMs: number };
  auth: { last24h: { logins: number; failures: number }; last7d: { logins: number; failures: number } };
  notifications: {
    pending: number;
    sentLast24h: number;
    failedLast24h: number;
    oldestPendingAgeMinutes: number | null;
    lastDispatchRunAt: string | null;
    lastDispatchStatus: 'OK' | 'STALE' | 'UNKNOWN';
  };
  payments: {
    paidToday: number;
    paidThisWeek: number;
    pendingCount: number;
    failedLast24h: number;
    totalCollectedThisWeek: number;
    webhookDeliveries: { successLast24h: number; failedLast24h: number };
  };
};

const STATUS_STYLES: Record<string, string> = {
  OK: 'bg-emerald-50 text-emerald-700',
  STALE: 'bg-amber-50 text-amber-700',
  DOWN: 'bg-rose-50 text-rose-700',
  UNKNOWN: 'bg-slate-100 text-slate-500',
};

function StatusBadge({ status }: { status: string }) {
  return <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_STYLES[status] ?? STATUS_STYLES.UNKNOWN}`}>{status}</span>;
}

function SectionHeading({ title, status }: { title: string; status: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <h2 className="text-sm font-semibold text-slate-600">{title}</h2>
      <StatusBadge status={status} />
    </div>
  );
}

type Tab = 'overview' | 'configuration';

export default function SystemHealthPage() {
  return (
    <Suspense fallback={<p className="text-sm text-slate-400 text-center py-6">Loading…</p>}>
      <SystemHealthContent />
    </Suspense>
  );
}

// useSearchParams() (for the ?tab=configuration deep link) needs a Suspense
// boundary in the App Router — same pattern already used in
// super-admin/audit/page.tsx for its own searchParams-dependent section.
function SystemHealthContent() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [err, setErr] = useState('');
  const router = useRouter();
  const searchParams = useSearchParams();
  const { hasPermission } = usePlatformPermissions();
  const canManageSettings = hasPermission('MANAGE_PLATFORM_SETTINGS');

  const tab: Tab = searchParams.get('tab') === 'configuration' ? 'configuration' : 'overview';

  function setTab(next: Tab) {
    router.replace(next === 'configuration' ? '/super-admin/system-health?tab=configuration' : '/super-admin/system-health');
  }

  useEffect(() => {
    apiFetch<Overview>('/super-admin/system-health/overview')
      .then(setOverview)
      .catch((e) => setErr(e instanceof Error ? e.message : 'Failed to load system health'));
  }, []);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">System Health</h1>
        <p className="text-sm text-slate-500 mt-0.5">A real-time operational snapshot — every number here is measured live or drawn from real records, not projected.</p>
      </div>

      {/* Hand-rolled tab toggle — no Tabs component exists anywhere in this
          codebase yet, and pulling in shadcn/radix for two buttons would be
          inconsistent with everything else here. The Configuration tab is
          only shown to SuperAdmins with MANAGE_PLATFORM_SETTINGS — a UX
          layer matching how SuperAdminShell already filters nav items; the
          real boundary is the backend's own @RequirePlatformPermission. */}
      {canManageSettings && (
        <div className="flex gap-1 border-b border-slate-200">
          <button
            onClick={() => setTab('overview')}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === 'overview' ? 'border-slate-900 text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            Overview
          </button>
          <button
            onClick={() => setTab('configuration')}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === 'configuration' ? 'border-slate-900 text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            Configuration
          </button>
        </div>
      )}

      {tab === 'configuration' && canManageSettings ? (
        <ConfigurationTab />
      ) : err ? (
        <p className="text-sm text-red-600">{err}</p>
      ) : !overview ? (
        <p className="text-sm text-slate-400 text-center py-6">Loading…</p>
      ) : (
        <>
          <section>
            <SectionHeading title="API" status={overview.api.status} />
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-white border border-slate-200 rounded-xl px-5 py-4">
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Version</p>
                <p className="text-lg font-semibold mt-1 text-slate-800">{overview.api.version}</p>
              </div>
              <div className="bg-white border border-slate-200 rounded-xl px-5 py-4">
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Server time</p>
                <p className="text-sm mt-1 text-slate-600">{new Date(overview.api.timestamp).toLocaleString()}</p>
              </div>
            </div>
          </section>

          <section>
            <SectionHeading title="Database" status={overview.database.status} />
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <StatCard label="Latency" value={overview.database.latencyMs} accent={overview.database.status === 'OK' ? undefined : 'text-rose-600'} />
            </div>
          </section>

          <section>
            <h2 className="text-sm font-semibold text-slate-600 mb-3">Auth</h2>
            <p className="text-xs text-slate-400 mb-3">Real login/failure counts from audit_logs — no computed health verdict, since there's no non-arbitrary threshold for it.</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <StatCard label="Logins (24h)" value={overview.auth.last24h.logins} accent="text-emerald-600" />
              <StatCard label="Failures (24h)" value={overview.auth.last24h.failures} accent="text-rose-600" />
              <StatCard label="Logins (7d)" value={overview.auth.last7d.logins} accent="text-emerald-600" />
              <StatCard label="Failures (7d)" value={overview.auth.last7d.failures} accent="text-rose-600" />
            </div>
          </section>

          <section>
            <SectionHeading title="Notifications" status={overview.notifications.lastDispatchStatus} />
            <p className="text-xs text-slate-400 mb-3">
              {overview.notifications.lastDispatchRunAt
                ? `Dispatch cron last ran ${new Date(overview.notifications.lastDispatchRunAt).toLocaleString()}.`
                : 'Dispatch cron has not reported a run yet.'}
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <StatCard label="Pending" value={overview.notifications.pending} />
              <StatCard label="Sent (24h)" value={overview.notifications.sentLast24h} accent="text-emerald-600" />
              <StatCard label="Failed (24h)" value={overview.notifications.failedLast24h} accent="text-rose-600" />
              <StatCard label="Oldest pending (min)" value={overview.notifications.oldestPendingAgeMinutes ?? 0} />
            </div>
          </section>

          <section>
            <h2 className="text-sm font-semibold text-slate-600 mb-3">Payments</h2>
            <p className="text-xs text-slate-400 mb-3">Platform-wide transaction and webhook-delivery counts — real records, no computed verdict.</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-3">
              <StatCard label="Paid today" value={overview.payments.paidToday} accent="text-emerald-600" />
              <StatCard label="Paid this week" value={overview.payments.paidThisWeek} accent="text-emerald-600" />
              <StatCard label="Pending" value={overview.payments.pendingCount} />
              <StatCard label="Failed (24h)" value={overview.payments.failedLast24h} accent="text-rose-600" />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <StatCard label="Collected this week" value={overview.payments.totalCollectedThisWeek} accent="text-emerald-600" />
              <StatCard label="Webhook deliveries OK (24h)" value={overview.payments.webhookDeliveries.successLast24h} accent="text-emerald-600" />
              <StatCard label="Webhook deliveries failed (24h)" value={overview.payments.webhookDeliveries.failedLast24h} accent="text-rose-600" />
            </div>
          </section>
        </>
      )}
    </div>
  );
}
