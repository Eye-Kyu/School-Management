'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import StatCard from '../StatCard';

type DashboardStats = {
  totalSchools: number;
  schoolsByStatus: { ACTIVE: number; INACTIVE: number; SUSPENDED: number; ARCHIVED: number };
  totalUsers: number;
  usersByRole: { ADMIN: number; TEACHER: number; STUDENT: number; PARENT: number };
};

export default function SuperAdminDashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    apiFetch<DashboardStats>('/super-admin/dashboard')
      .then(setStats)
      .catch((e) => setErr(e instanceof Error ? e.message : 'Failed to load dashboard'));
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-sm text-slate-500 mt-0.5">Platform overview.</p>
      </div>

      {err && <p className="text-sm text-red-600">{err}</p>}

      {!stats ? (
        <p className="text-sm text-slate-400 text-center py-10">Loading…</p>
      ) : (
        <>
          <section>
            <h2 className="text-sm font-semibold text-slate-600 mb-3">Schools</h2>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
              <StatCard label="Total schools" value={stats.totalSchools} />
              <StatCard label="Active" value={stats.schoolsByStatus.ACTIVE} accent="text-emerald-600" />
              <StatCard label="Inactive" value={stats.schoolsByStatus.INACTIVE} accent="text-slate-400" />
              <StatCard label="Suspended" value={stats.schoolsByStatus.SUSPENDED} accent="text-amber-600" />
              <StatCard label="Archived" value={stats.schoolsByStatus.ARCHIVED} accent="text-rose-600" />
            </div>
          </section>

          <section>
            <h2 className="text-sm font-semibold text-slate-600 mb-3">Platform users</h2>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
              <StatCard label="Total users" value={stats.totalUsers} />
              <StatCard label="Admins" value={stats.usersByRole.ADMIN} />
              <StatCard label="Teachers" value={stats.usersByRole.TEACHER} />
              <StatCard label="Students" value={stats.usersByRole.STUDENT} />
              <StatCard label="Parents" value={stats.usersByRole.PARENT} />
            </div>
          </section>

          <p className="text-xs text-slate-400">
            Growth trends, revenue, module adoption, and school health scores are planned for a later phase —
            shown here only once backed by real data.
          </p>
        </>
      )}
    </div>
  );
}
