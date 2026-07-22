'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import BackButton from '@/components/BackButton';
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

type OnboardResult = {
  school: { id: string; name: string; slug: string };
  admin: { full_name: string; email: string | null; phone: string | null; temporaryPassword: string };
};

const STEPS = ['School info', 'Initial admin', 'Modules', 'Review & create'];

function slugify(name: string) {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export default function OnboardSchoolPage() {
  const [step, setStep] = useState(0);

  // Step 1 — School info
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');

  // Step 2 — Initial admin
  const [adminName, setAdminName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPhone, setAdminPhone] = useState('');

  // Step 3 — Modules
  const [modules, setModules] = useState<ModuleRow[]>([]);
  const [modulesLoading, setModulesLoading] = useState(true);
  const [disabledKeys, setDisabledKeys] = useState<Set<string>>(new Set());

  // Submit
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState('');
  const [result, setResult] = useState<OnboardResult | null>(null);

  useEffect(() => {
    apiFetch<ModuleRow[]>('/super-admin/modules')
      .then(setModules)
      .catch(() => {})
      .finally(() => setModulesLoading(false));
  }, []);

  function stepValid(s: number): boolean {
    if (s === 0) return name.trim().length >= 2 && /^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(slug);
    if (s === 1) return adminName.trim().length >= 2 && (adminEmail.trim() !== '' || adminPhone.trim() !== '');
    return true;
  }

  function toggleDisabled(key: string) {
    setDisabledKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  async function handleCreate() {
    setSubmitting(true);
    setErr('');
    try {
      const res = await apiFetch<OnboardResult>('/super-admin/schools/onboard', {
        method: 'POST',
        body: JSON.stringify({
          school: { name, slug, phone: phone || undefined, email: email || undefined, address: address || undefined },
          admin: { fullName: adminName, email: adminEmail || undefined, phone: adminPhone || undefined },
          disabledModuleKeys: [...disabledKeys],
        }),
      });
      setResult(res);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to onboard school');
    } finally {
      setSubmitting(false);
    }
  }

  const byCategory = modules.reduce<Record<string, ModuleRow[]>>((acc, m) => {
    (acc[m.category] ??= []).push(m);
    return acc;
  }, {});

  if (result) {
    return (
      <div className="space-y-6 max-w-lg">
        <div>
          <h1 className="text-2xl font-semibold">School created</h1>
          <p className="text-sm text-slate-500 mt-0.5">{result.school.name} is ready to go.</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
          <p className="text-sm text-slate-600">
            Share these credentials with the school's admin — this password is shown only once.
          </p>
          <div className="bg-slate-50 rounded-lg p-4 space-y-1 text-sm font-mono">
            <p>{result.admin.email ?? result.admin.phone}</p>
            <p className="text-lg font-semibold">{result.admin.temporaryPassword}</p>
          </div>
        </div>
        <Link
          href={`/super-admin/schools/${result.school.id}`}
          className="inline-block px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-700"
        >
          Go to school →
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-lg">
      <BackButton href="/super-admin/schools" />

      <div>
        <h1 className="text-2xl font-semibold">Onboard a school</h1>
        <p className="text-sm text-slate-500 mt-0.5">Step {step + 1} of {STEPS.length}: {STEPS[step]}</p>
      </div>

      <div className="flex gap-2">
        {STEPS.map((label, i) => (
          <div key={label} className={`h-1.5 flex-1 rounded-full ${i <= step ? 'bg-slate-900' : 'bg-slate-200'}`} />
        ))}
      </div>

      {err && <p className="text-sm text-rose-600 bg-rose-50 rounded px-3 py-2">{err}</p>}

      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        {step === 0 && (
          <>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">School name</label>
              <input
                value={name}
                onChange={(e) => { setName(e.target.value); if (!slugTouched) setSlug(slugify(e.target.value)); }}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                autoFocus
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Slug</label>
              <input
                value={slug}
                onChange={(e) => { setSlug(e.target.value); setSlugTouched(true); }}
                pattern="^[a-z0-9][a-z0-9-]*[a-z0-9]$"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Phone (optional)</label>
                <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+254700000000"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Email (optional)</label>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Address (optional)</label>
              <input value={address} onChange={(e) => setAddress(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <p className="text-xs text-slate-500">This person will be the school's first Admin and can create everyone else.</p>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Full name</label>
              <input value={adminName} onChange={(e) => setAdminName(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" autoFocus />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Email</label>
                <input type="email" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Phone</label>
                <input value={adminPhone} onChange={(e) => setAdminPhone(e.target.value)} placeholder="+254700000000"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
              </div>
            </div>
            <p className="text-xs text-slate-400">At least one of email or phone is required.</p>
          </>
        )}

        {step === 2 && (
          <>
            <p className="text-xs text-slate-500">
              Everything is enabled by default. Uncheck anything this school shouldn't have — you can change this anytime later.
            </p>
            {modulesLoading ? (
              <p className="text-sm text-slate-400 text-center py-6">Loading…</p>
            ) : (
              Object.entries(byCategory).map(([category, mods]) => (
                <div key={category}>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-1">{category}</p>
                  <div className="space-y-1">
                    {mods.map((m) => (
                      <label key={m.key} className={`flex items-center gap-2 text-sm px-2 py-1 rounded ${m.is_core ? 'opacity-50' : ''}`}>
                        <input
                          type="checkbox"
                          checked={!disabledKeys.has(m.key)}
                          disabled={m.is_core || !m.can_disable}
                          onChange={() => toggleDisabled(m.key)}
                        />
                        {m.name}
                        {m.is_core && <span className="text-xs text-slate-400">(core)</span>}
                      </label>
                    ))}
                  </div>
                </div>
              ))
            )}
          </>
        )}

        {step === 3 && (
          <div className="space-y-3 text-sm">
            <div>
              <p className="text-xs font-medium text-slate-500">School</p>
              <p className="font-medium">{name} <span className="text-slate-400 font-mono text-xs">/{slug}</span></p>
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500">Admin</p>
              <p className="font-medium">{adminName}</p>
              <p className="text-slate-500">{adminEmail || adminPhone}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500">Modules disabled at creation</p>
              <p className="text-slate-600">{disabledKeys.size === 0 ? 'None — everything enabled' : [...disabledKeys].join(', ')}</p>
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between">
        <button
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          disabled={step === 0}
          className="px-4 py-2 rounded-lg text-sm font-medium border border-slate-200 hover:bg-slate-50 disabled:opacity-40"
        >
          Back
        </button>
        {step < STEPS.length - 1 ? (
          <button
            onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}
            disabled={!stepValid(step)}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-slate-900 text-white hover:bg-slate-700 disabled:opacity-40"
          >
            Next
          </button>
        ) : (
          <button
            onClick={handleCreate}
            disabled={submitting}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-slate-900 text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {submitting ? 'Creating…' : 'Create school'}
          </button>
        )}
      </div>
    </div>
  );
}
