'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import StatCard from '../../StatCard';

type Growth = {
  days: number;
  schoolsByDay: { date: string; count: number }[];
  usersByDay: { date: string; count: number }[];
  totalNewSchools: number;
  totalNewUsers: number;
};

type ModuleAdoption = { key: string; name: string; enabledCount: number; totalSchools: number; percentage: number };

type PackageAnalytics = {
  packages: { id: string; name: string; price: number; currency: string; schoolCount: number }[];
  subscriptionChangesLast30Days: number;
};

type SchoolHealthStatus = 'HEALTHY' | 'NEEDS_ATTENTION' | 'AT_RISK' | 'INACTIVE';
type SchoolHealth = { id: string; name: string; status: SchoolHealthStatus; reasons: string[] };

const RANGE_OPTIONS = [7, 30, 90, 365];

const HEALTH_STYLES: Record<SchoolHealthStatus, string> = {
  HEALTHY: 'bg-emerald-50 text-emerald-700',
  NEEDS_ATTENTION: 'bg-amber-50 text-amber-700',
  AT_RISK: 'bg-rose-50 text-rose-700',
  INACTIVE: 'bg-slate-100 text-slate-500',
};

export default function AnalyticsPage() {
  const [days, setDays] = useState(30);
  const [growth, setGrowth] = useState<Growth | null>(null);
  const [modules, setModules] = useState<ModuleAdoption[] | null>(null);
  const [packages, setPackages] = useState<PackageAnalytics | null>(null);
  const [health, setHealth] = useState<SchoolHealth[] | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    apiFetch<Growth>(`/super-admin/analytics/growth?days=${days}`)
      .then(setGrowth)
      .catch((e) => setErr(e instanceof Error ? e.message : 'Failed to load growth analytics'));
  }, [days]);

  useEffect(() => {
    apiFetch<ModuleAdoption[]>('/super-admin/analytics/modules').then(setModules).catch(() => {});
    apiFetch<PackageAnalytics>('/super-admin/analytics/packages').then(setPackages).catch(() => {});
    apiFetch<SchoolHealth[]>('/super-admin/analytics/school-health').then(setHealth).catch(() => {});
  }, []);

  const healthByStatus = (health ?? []).reduce<Record<SchoolHealthStatus, SchoolHealth[]>>((acc, s) => {
    (acc[s.status] ??= []).push(s);
    return acc;
  }, {} as Record<SchoolHealthStatus, SchoolHealth[]>);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Analytics</h1>
        <p className="text-sm text-slate-500 mt-0.5">Real platform data only — nothing here is estimated or fabricated.</p>
      </div>

      {err && <p className="text-sm text-red-600">{err}</p>}

      {/* Growth */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-slate-600">Growth</h2>
          <div className="flex gap-1">
            {RANGE_OPTIONS.map((d) => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={`text-xs px-2.5 py-1 rounded-full font-medium transition-colors ${
                  days === d ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {d}d
              </button>
            ))}
          </div>
        </div>
        {!growth ? (
          <p className="text-sm text-slate-400 text-center py-6">Loading…</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4 mb-3">
              <StatCard label={`New schools (${growth.days}d)`} value={growth.totalNewSchools} accent="text-emerald-600" />
              <StatCard label={`New users (${growth.days}d)`} value={growth.totalNewUsers} accent="text-violet-600" />
            </div>
            {growth.schoolsByDay.length === 0 && growth.usersByDay.length === 0 ? (
              <p className="text-sm text-slate-400 bg-white border border-dashed border-slate-200 rounded-xl px-5 py-6 text-center">
                No new schools or users in this window.
              </p>
            ) : (
              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="text-left px-4 py-2 font-medium text-slate-500 text-xs">Date</th>
                      <th className="text-right px-4 py-2 font-medium text-slate-500 text-xs">New schools</th>
                      <th className="text-right px-4 py-2 font-medium text-slate-500 text-xs">New users</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {[...new Set([...growth.schoolsByDay.map((d) => d.date), ...growth.usersByDay.map((d) => d.date)])]
                      .sort()
                      .map((date) => (
                        <tr key={date}>
                          <td className="px-4 py-2 text-slate-700">{date}</td>
                          <td className="px-4 py-2 text-right text-slate-600">{growth.schoolsByDay.find((d) => d.date === date)?.count ?? 0}</td>
                          <td className="px-4 py-2 text-right text-slate-600">{growth.usersByDay.find((d) => d.date === date)?.count ?? 0}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </section>

      {/* Module adoption */}
      <section>
        <h2 className="text-sm font-semibold text-slate-600 mb-3">Module adoption</h2>
        {!modules ? (
          <p className="text-sm text-slate-400 text-center py-6">Loading…</p>
        ) : modules.length === 0 ? (
          <p className="text-sm text-slate-400">No schools yet.</p>
        ) : (
          <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
            {[...modules].sort((a, b) => b.percentage - a.percentage).map((m) => (
              <div key={m.key}>
                <div className="flex items-center justify-between text-sm mb-1">
                  <span className="text-slate-700">{m.name}</span>
                  <span className="text-slate-400 text-xs">{m.enabledCount}/{m.totalSchools} schools ({m.percentage}%)</span>
                </div>
                <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                  <div className="h-full bg-violet-500" style={{ width: `${m.percentage}%` }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Package distribution */}
      <section>
        <h2 className="text-sm font-semibold text-slate-600 mb-3">Packages</h2>
        {!packages ? (
          <p className="text-sm text-slate-400 text-center py-6">Loading…</p>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-3">
              {packages.packages.map((p) => (
                <StatCard key={p.id} label={p.name} value={p.schoolCount} />
              ))}
              <StatCard label="Subscription changes (30d)" value={packages.subscriptionChangesLast30Days} accent="text-violet-600" />
            </div>
          </>
        )}
      </section>

      {/* School health */}
      <section>
        <h2 className="text-sm font-semibold text-slate-600 mb-3">School health</h2>
        <p className="text-xs text-slate-400 mb-3">Based on real login, attendance, and gradebook activity — not an opaque score.</p>
        {!health ? (
          <p className="text-sm text-slate-400 text-center py-6">Loading…</p>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
              <StatCard label="Healthy" value={healthByStatus.HEALTHY?.length ?? 0} accent="text-emerald-600" />
              <StatCard label="Needs attention" value={healthByStatus.NEEDS_ATTENTION?.length ?? 0} accent="text-amber-600" />
              <StatCard label="At risk" value={healthByStatus.AT_RISK?.length ?? 0} accent="text-rose-600" />
              <StatCard label="Inactive" value={healthByStatus.INACTIVE?.length ?? 0} accent="text-slate-400" />
            </div>
            {[...(healthByStatus.AT_RISK ?? []), ...(healthByStatus.NEEDS_ATTENTION ?? [])].length === 0 ? (
              <p className="text-sm text-slate-400">No schools currently need attention.</p>
            ) : (
              <div className="bg-white border border-slate-100 rounded-xl divide-y divide-slate-100">
                {[...(healthByStatus.AT_RISK ?? []), ...(healthByStatus.NEEDS_ATTENTION ?? [])].map((s) => (
                  <Link
                    key={s.id}
                    href={`/super-admin/schools/${s.id}`}
                    className="flex items-center justify-between px-5 py-3 hover:bg-slate-50 transition-colors"
                  >
                    <div>
                      <p className="font-medium text-slate-800">{s.name}</p>
                      <p className="text-xs text-slate-400 mt-0.5">{s.reasons.join(' · ')}</p>
                    </div>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full shrink-0 ${HEALTH_STYLES[s.status]}`}>
                      {s.status.replace('_', ' ')}
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
