'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import BackButton from '@/components/BackButton';
import { apiFetch, ApiError } from '@/lib/api';

type ModuleRow = {
  key: string;
  name: string;
  description: string;
  category: string;
  is_core: boolean;
  can_disable: boolean;
  status: string;
  dependencies: string[];
  enabled: boolean;
};

export default function SchoolModulesPage() {
  const params = useParams<{ schoolId: string }>();
  const schoolId = params.schoolId;

  const [modules, setModules] = useState<ModuleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);

  function load() {
    setLoading(true);
    apiFetch<ModuleRow[]>(`/super-admin/schools/${schoolId}/modules`)
      .then(setModules)
      .catch((e) => setErr(e instanceof Error ? e.message : 'Failed to load modules'))
      .finally(() => setLoading(false));
  }

  useEffect(load, [schoolId]);

  async function toggle(m: ModuleRow) {
    const next = !m.enabled;
    const verb = next ? 'enable' : 'disable';
    if (!confirm(`${verb === 'enable' ? 'Enable' : 'Disable'} "${m.name}" for this school?`)) return;

    setBusyKey(m.key);
    setErr('');
    setWarnings([]);
    try {
      const res = await apiFetch<{ ok: boolean; warnings: string[] }>(
        `/super-admin/schools/${schoolId}/modules/${m.key}`,
        { method: 'PATCH', body: JSON.stringify({ enabled: next }) },
      );
      setWarnings(res.warnings ?? []);
      load();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Failed to update module');
    } finally {
      setBusyKey(null);
    }
  }

  const byCategory = modules.reduce<Record<string, ModuleRow[]>>((acc, m) => {
    (acc[m.category] ??= []).push(m);
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <BackButton href="/super-admin" />
        <div>
          <h1 className="text-2xl font-semibold">School modules</h1>
          <p className="text-sm text-slate-500 mt-0.5">Enable or disable features for this school. Disabling never deletes data.</p>
        </div>
      </div>

      {err && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{err}</p>}
      {warnings.length > 0 && (
        <div className="text-sm text-amber-700 bg-amber-50 rounded-lg px-3 py-2 space-y-1">
          {warnings.map((w) => <p key={w}>⚠ {w}</p>)}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-slate-400 text-center py-10">Loading…</p>
      ) : (
        Object.entries(byCategory).map(([category, mods]) => (
          <div key={category} className="space-y-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">{category}</h2>
            <div className="bg-white border border-slate-100 rounded-xl divide-y divide-slate-100">
              {mods.map((m) => (
                <div key={m.key} className="flex items-center justify-between px-5 py-3">
                  <div>
                    <p className="font-medium text-slate-800 flex items-center gap-2">
                      {m.name}
                      {m.is_core && (
                        <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">Core</span>
                      )}
                      {m.status === 'COMING_SOON' && (
                        <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-violet-50 text-violet-600">Coming soon</span>
                      )}
                    </p>
                    <p className="text-xs text-slate-400 mt-0.5">{m.description}</p>
                    {m.dependencies.length > 0 && (
                      <p className="text-xs text-slate-400 mt-0.5">Requires: {m.dependencies.join(', ')}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${m.enabled ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                      {m.enabled ? 'Enabled' : 'Disabled'}
                    </span>
                    <button
                      onClick={() => toggle(m)}
                      disabled={m.is_core || !m.can_disable || busyKey === m.key}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium border border-slate-200 hover:bg-slate-50 disabled:opacity-40 transition-colors"
                    >
                      {busyKey === m.key ? '…' : m.enabled ? 'Disable' : 'Enable'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
