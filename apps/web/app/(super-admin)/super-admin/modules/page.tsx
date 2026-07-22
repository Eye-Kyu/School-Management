'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';

type ModuleRow = {
  key: string;
  name: string;
  description: string;
  category: string;
  is_core: boolean;
  can_disable: boolean;
  status: string;
  dependencies: string[];
};

type ModuleAdoption = { key: string; name: string; enabledCount: number; totalSchools: number; percentage: number };

export default function ModuleRegistryPage() {
  const [modules, setModules] = useState<ModuleRow[] | null>(null);
  const [adoption, setAdoption] = useState<ModuleAdoption[] | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    apiFetch<ModuleRow[]>('/super-admin/modules').then(setModules).catch((e) => setErr(e instanceof Error ? e.message : 'Failed to load module catalogue'));
    apiFetch<ModuleAdoption[]>('/super-admin/analytics/modules').then(setAdoption).catch(() => {});
  }, []);

  const adoptionByKey = new Map((adoption ?? []).map((a) => [a.key, a]));

  const byCategory = (modules ?? []).reduce<Record<string, ModuleRow[]>>((acc, m) => {
    (acc[m.category] ??= []).push(m);
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Modules</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Platform-wide module registry, dependencies, and adoption. To toggle a module for a specific school, go to Schools → select a school.
        </p>
      </div>

      {err && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{err}</p>}

      {!modules ? (
        <p className="text-sm text-slate-400 text-center py-10">Loading…</p>
      ) : (
        Object.entries(byCategory).map(([category, mods]) => (
          <div key={category} className="space-y-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">{category}</h2>
            <div className="bg-white border border-slate-100 rounded-xl divide-y divide-slate-100">
              {mods.map((m) => {
                const a = adoptionByKey.get(m.key);
                return (
                  <div key={m.key} className="px-5 py-3">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="font-medium text-slate-800 flex items-center gap-2">
                          {m.name}
                          {m.is_core && <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">Core</span>}
                          {m.status === 'COMING_SOON' && <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-violet-50 text-violet-600">Coming soon</span>}
                        </p>
                        <p className="text-xs text-slate-400 mt-0.5">{m.description}</p>
                        {m.dependencies.length > 0 && (
                          <p className="text-xs text-slate-400 mt-0.5">Requires: {m.dependencies.join(', ')}</p>
                        )}
                      </div>
                      {a && (
                        <div className="w-40 shrink-0">
                          <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
                            <span>{a.enabledCount}/{a.totalSchools} schools</span>
                            <span>{a.percentage}%</span>
                          </div>
                          <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                            <div className="h-full bg-violet-500" style={{ width: `${a.percentage}%` }} />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
