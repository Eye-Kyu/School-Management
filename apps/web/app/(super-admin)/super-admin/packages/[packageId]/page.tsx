'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import BackButton from '@/components/BackButton';
import { apiFetch } from '@/lib/api';

type PackageDetail = {
  id: string;
  name: string;
  description: string;
  price: number;
  currency: string;
  billing_cycle: 'MONTHLY' | 'ANNUAL';
  is_active: boolean;
  modules: { moduleKey: string; entitlement: 'INCLUDED' | 'OPTIONAL_ADD_ON' }[];
};

type ModuleRow = {
  key: string;
  name: string;
  description: string;
  category: string;
  is_core: boolean;
};

type Entitlement = 'NOT_AVAILABLE' | 'OPTIONAL_ADD_ON' | 'INCLUDED';

export default function PackageDetailPage() {
  const params = useParams<{ packageId: string }>();
  const packageId = params.packageId;

  const [pkg, setPkg] = useState<PackageDetail | null>(null);
  const [modules, setModules] = useState<ModuleRow[]>([]);
  const [entitlements, setEntitlements] = useState<Record<string, Entitlement>>({});
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('0');
  const [billingCycle, setBillingCycle] = useState<'MONTHLY' | 'ANNUAL'>('MONTHLY');
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingModules, setSavingModules] = useState(false);

  function load() {
    setLoading(true);
    Promise.all([
      apiFetch<PackageDetail>(`/super-admin/packages/${packageId}`),
      apiFetch<ModuleRow[]>('/super-admin/modules'),
    ])
      .then(([p, m]) => {
        setPkg(p);
        setModules(m);
        setName(p.name); setDescription(p.description); setPrice(String(p.price));
        setBillingCycle(p.billing_cycle); setIsActive(p.is_active);
        const map: Record<string, Entitlement> = {};
        for (const mod of p.modules) map[mod.moduleKey] = mod.entitlement;
        setEntitlements(map);
      })
      .catch((e) => setErr(e instanceof Error ? e.message : 'Failed to load package'))
      .finally(() => setLoading(false));
  }

  useEffect(load, [packageId]);

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErr('');
    try {
      await apiFetch(`/super-admin/packages/${packageId}`, {
        method: 'PATCH',
        body: JSON.stringify({ name, description, price: Number(price), billingCycle, isActive }),
      });
      setEditing(false);
      load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to update package');
    } finally {
      setSaving(false);
    }
  }

  function setEntitlement(key: string, value: Entitlement) {
    setEntitlements((prev) => ({ ...prev, [key]: value }));
  }

  async function saveModules() {
    setSavingModules(true);
    setErr('');
    try {
      const payload = Object.entries(entitlements)
        .filter(([, v]) => v !== 'NOT_AVAILABLE')
        .map(([moduleKey, entitlement]) => ({ moduleKey, entitlement }));
      await apiFetch(`/super-admin/packages/${packageId}/modules`, {
        method: 'PUT',
        body: JSON.stringify({ modules: payload }),
      });
      load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to update modules');
    } finally {
      setSavingModules(false);
    }
  }

  const byCategory = modules.reduce<Record<string, ModuleRow[]>>((acc, m) => {
    (acc[m.category] ??= []).push(m);
    return acc;
  }, {});

  if (loading || !pkg) {
    return (
      <div className="space-y-6">
        <BackButton href="/super-admin/packages" />
        <p className="text-sm text-slate-400 text-center py-10">Loading…</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <BackButton href="/super-admin/packages" />
      {err && <p className="text-sm text-rose-600 bg-rose-50 rounded-lg px-3 py-2">{err}</p>}

      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold">{pkg.name}</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              {pkg.currency} {pkg.price.toLocaleString()} /{pkg.billing_cycle === 'MONTHLY' ? 'mo' : 'yr'}
              {!pkg.is_active && <span className="ml-2 text-xs font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">Inactive</span>}
            </p>
          </div>
          <button
            onClick={() => setEditing((v) => !v)}
            className="px-3 py-1.5 rounded-lg text-xs font-medium border border-slate-200 hover:bg-slate-50 transition-colors shrink-0"
          >
            {editing ? 'Cancel' : 'Edit'}
          </button>
        </div>

        {editing ? (
          <form onSubmit={saveProfile} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} required
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Description</label>
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Price ({pkg.currency})</label>
                <input type="number" min="0" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Billing cycle</label>
                <select value={billingCycle} onChange={(e) => setBillingCycle(e.target.value as 'MONTHLY' | 'ANNUAL')}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm">
                  <option value="MONTHLY">Monthly</option>
                  <option value="ANNUAL">Annual</option>
                </select>
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
              Active (visible for assignment)
            </label>
            <button type="submit" disabled={saving}
              className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-700 disabled:opacity-50">
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </form>
        ) : (
          <p className="text-sm text-slate-600">{pkg.description || '—'}</p>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-semibold">Module entitlements</h2>
          <button
            onClick={saveModules}
            disabled={savingModules}
            className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-700 disabled:opacity-50"
          >
            {savingModules ? 'Saving…' : 'Save entitlements'}
          </button>
        </div>
        <p className="text-sm text-slate-500 mb-4">Core modules are always on for every school regardless of package.</p>

        {Object.entries(byCategory).map(([category, mods]) => (
          <div key={category} className="space-y-2 mb-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">{category}</h3>
            <div className="bg-white border border-slate-100 rounded-xl divide-y divide-slate-100">
              {mods.map((m) => {
                const value: Entitlement = m.is_core ? 'INCLUDED' : (entitlements[m.key] ?? 'NOT_AVAILABLE');
                return (
                  <div key={m.key} className="flex items-center justify-between px-5 py-3">
                    <div>
                      <p className="font-medium text-slate-800 flex items-center gap-2">
                        {m.name}
                        {m.is_core && <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">Core</span>}
                      </p>
                      <p className="text-xs text-slate-400 mt-0.5">{m.description}</p>
                    </div>
                    {m.is_core ? (
                      <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700">Included</span>
                    ) : (
                      <select
                        value={value}
                        onChange={(e) => setEntitlement(m.key, e.target.value as Entitlement)}
                        className="text-xs border border-slate-200 rounded-lg px-2 py-1.5"
                      >
                        <option value="NOT_AVAILABLE">Not available</option>
                        <option value="OPTIONAL_ADD_ON">Optional add-on</option>
                        <option value="INCLUDED">Included</option>
                      </select>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
