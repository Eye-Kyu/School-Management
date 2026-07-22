'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';

type SchoolStatus = 'ACTIVE' | 'INACTIVE' | 'SUSPENDED' | 'ARCHIVED';
type School = { id: string; name: string; slug: string; status: SchoolStatus; created_at: string };

const STATUS_STYLES: Record<SchoolStatus, string> = {
  ACTIVE: 'bg-emerald-50 text-emerald-700',
  INACTIVE: 'bg-slate-100 text-slate-500',
  SUSPENDED: 'bg-amber-50 text-amber-700',
  ARCHIVED: 'bg-rose-50 text-rose-700',
};

export default function SuperAdminSchoolsPage() {
  const [schools, setSchools] = useState<School[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    apiFetch<School[]>('/super-admin/schools')
      .then(setSchools)
      .catch((e) => setErr(e instanceof Error ? e.message : 'Failed to load schools'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Schools</h1>
          <p className="text-sm text-slate-500 mt-0.5">Manage which features are enabled for each school.</p>
        </div>
        <Link
          href="/super-admin/schools/onboard"
          className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-700"
        >
          + New school
        </Link>
      </div>

      {err && <p className="text-sm text-red-600">{err}</p>}

      {loading ? (
        <p className="text-sm text-slate-400 text-center py-10">Loading…</p>
      ) : schools.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-white p-10 text-center text-sm text-slate-400">
          No schools registered yet.
        </div>
      ) : (
        <div className="bg-white border border-slate-100 rounded-xl divide-y divide-slate-100">
          {schools.map((s) => (
            <Link
              key={s.id}
              href={`/super-admin/schools/${s.id}`}
              className="flex items-center justify-between px-5 py-3 hover:bg-slate-50 transition-colors"
            >
              <div>
                <p className="font-medium text-slate-800">{s.name}</p>
                <p className="text-xs text-slate-400 mt-0.5">/{s.slug}</p>
              </div>
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_STYLES[s.status]}`}>
                {s.status}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
