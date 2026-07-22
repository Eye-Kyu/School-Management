'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';

type Package = {
  id: string;
  name: string;
  description: string;
  price: number;
  currency: string;
  billing_cycle: 'MONTHLY' | 'ANNUAL';
  is_active: boolean;
  schoolCount: number;
};

export default function PackagesPage() {
  const [packages, setPackages] = useState<Package[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('0');
  const [billingCycle, setBillingCycle] = useState<'MONTHLY' | 'ANNUAL'>('MONTHLY');
  const [saving, setSaving] = useState(false);
  const [formErr, setFormErr] = useState('');

  function load() {
    setLoading(true);
    apiFetch<Package[]>('/super-admin/packages')
      .then(setPackages)
      .catch((e) => setErr(e instanceof Error ? e.message : 'Failed to load packages'))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFormErr('');
    try {
      await apiFetch('/super-admin/packages', {
        method: 'POST',
        body: JSON.stringify({ name, description: description || undefined, price: Number(price), billingCycle }),
      });
      setShowForm(false);
      setName(''); setDescription(''); setPrice('0'); setBillingCycle('MONTHLY');
      load();
    } catch (e) {
      setFormErr(e instanceof Error ? e.message : 'Failed to create package');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Packages & Plans</h1>
          <p className="text-sm text-slate-500 mt-0.5">Pricing tiers and which modules they include.</p>
        </div>
        <button
          onClick={() => { setShowForm((v) => !v); setFormErr(''); }}
          className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-700"
        >
          {showForm ? 'Cancel' : '+ New package'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="bg-white border border-slate-200 rounded-xl p-5 space-y-4 max-w-lg">
          {formErr && <p className="text-sm text-rose-600 bg-rose-50 rounded px-3 py-2">{formErr}</p>}
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
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Price (KES)</label>
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
          <button type="submit" disabled={saving}
            className="px-5 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-700 disabled:opacity-50">
            {saving ? 'Creating…' : 'Create package'}
          </button>
        </form>
      )}

      {err && <p className="text-sm text-red-600">{err}</p>}

      {loading ? (
        <p className="text-sm text-slate-400 text-center py-10">Loading…</p>
      ) : packages.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-white p-10 text-center text-sm text-slate-400">
          No packages yet.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {packages.map((p) => (
            <Link
              key={p.id}
              href={`/super-admin/packages/${p.id}`}
              className="bg-white border border-slate-200 rounded-xl p-5 hover:border-slate-300 transition-colors"
            >
              <div className="flex items-center justify-between mb-1">
                <h2 className="font-semibold text-slate-800">{p.name}</h2>
                {!p.is_active && (
                  <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">Inactive</span>
                )}
              </div>
              <p className="text-2xl font-bold text-slate-800">
                {p.currency} {p.price.toLocaleString()}
                <span className="text-sm font-normal text-slate-400"> /{p.billing_cycle === 'MONTHLY' ? 'mo' : 'yr'}</span>
              </p>
              <p className="text-sm text-slate-500 mt-2">{p.description}</p>
              <p className="text-xs text-slate-400 mt-3">{p.schoolCount} school{p.schoolCount !== 1 ? 's' : ''} subscribed</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
