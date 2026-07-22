'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';

type Curriculum = {
  id: string;
  name: string;
  description: string;
  is_active: boolean;
  subjectCount: number;
};

export default function CurriculumPage() {
  const [curricula, setCurricula] = useState<Curriculum[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [formErr, setFormErr] = useState('');

  function load() {
    setLoading(true);
    apiFetch<Curriculum[]>('/super-admin/curricula')
      .then(setCurricula)
      .catch((e) => setErr(e instanceof Error ? e.message : 'Failed to load curricula'))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFormErr('');
    try {
      await apiFetch('/super-admin/curricula', {
        method: 'POST',
        body: JSON.stringify({ name, description: description || undefined }),
      });
      setShowForm(false);
      setName(''); setDescription('');
      load();
    } catch (e) {
      setFormErr(e instanceof Error ? e.message : 'Failed to create curriculum');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Curriculum</h1>
          <p className="text-sm text-slate-500 mt-0.5">Global curriculum frameworks schools can be tagged with, e.g. Kenya CBC, 8-4-4.</p>
        </div>
        <button
          onClick={() => { setShowForm((v) => !v); setFormErr(''); }}
          className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-700"
        >
          {showForm ? 'Cancel' : '+ New curriculum'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="bg-white border border-slate-200 rounded-xl p-5 space-y-4 max-w-lg">
          {formErr && <p className="text-sm text-rose-600 bg-rose-50 rounded px-3 py-2">{formErr}</p>}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="e.g. Kenya CBC"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Description</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
          </div>
          <button type="submit" disabled={saving}
            className="px-5 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-700 disabled:opacity-50">
            {saving ? 'Creating…' : 'Create curriculum'}
          </button>
        </form>
      )}

      {err && <p className="text-sm text-red-600">{err}</p>}

      {loading ? (
        <p className="text-sm text-slate-400 text-center py-10">Loading…</p>
      ) : curricula.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-white p-10 text-center text-sm text-slate-400">
          No curricula yet.
        </div>
      ) : (
        <div className="bg-white border border-slate-100 rounded-xl divide-y divide-slate-100">
          {curricula.map((c) => (
            <Link
              key={c.id}
              href={`/super-admin/curriculum/${c.id}`}
              className="flex items-center justify-between px-5 py-3 hover:bg-slate-50 transition-colors"
            >
              <div>
                <p className="font-medium text-slate-800">{c.name}</p>
                <p className="text-xs text-slate-400 mt-0.5">{c.description || 'No description'}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-xs text-slate-400">{c.subjectCount} subject{c.subjectCount !== 1 ? 's' : ''}</span>
                {!c.is_active && (
                  <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">Inactive</span>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
