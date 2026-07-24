'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import BackButton from '@/components/BackButton';
import { apiFetch, ApiError } from '@/lib/api';
import { usePlatformPermissions } from '@/lib/hooks/usePlatformPermissions';
import {
  formatRemaining,
  notifyPrivilegedAccessChanged,
  PRIVILEGED_ACCESS_SCOPE_LABELS,
  PRIVILEGED_ACCESS_WIRED_SCOPES,
  type PrivilegedAccessGrant,
  type PrivilegedAccessScope,
} from '@/lib/privilegedAccess';
import StatCard from '../../../StatCard';

type SchoolStatus = 'ACTIVE' | 'INACTIVE' | 'SUSPENDED' | 'ARCHIVED';

type School = {
  id: string;
  name: string;
  slug: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  timezone: string;
  status: SchoolStatus;
  created_at: string;
};

type SchoolOverview = {
  users: {
    total: number;
    byRole: { ADMIN: number; TEACHER: number; STUDENT: number; PARENT: number };
    active: number;
    inactive: number;
    newThisMonth: number;
  };
  academic: {
    classCount: number;
    subjectCount: number;
    studentsPerGrade: Record<string, number>;
    attendance: { recordCount: number; presentRate: number | null };
    assessmentsCreatedLast30Days: number;
    gradesRecordedLast30Days: number;
  };
  engagement: {
    dau: number;
    wau: number;
    mau: number;
    loginsByRoleLast7Days: { ADMIN: number; TEACHER: number; STUDENT: number; PARENT: number };
  };
};

type EntitlementSource = 'OVERRIDE' | 'CORE' | 'PACKAGE_INCLUDED' | 'PACKAGE_ADD_ON' | 'PACKAGE_UNAVAILABLE' | 'DEFAULT';

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
  entitlementSource: EntitlementSource;
};

const SOURCE_LABELS: Record<EntitlementSource, string> = {
  OVERRIDE: 'Manual override',
  CORE: 'Core',
  PACKAGE_INCLUDED: 'Included in package',
  PACKAGE_ADD_ON: 'Add-on (not activated)',
  PACKAGE_UNAVAILABLE: 'Not in package',
  DEFAULT: 'Default (no package)',
};

type Subscription = {
  id: string;
  package_id: string;
  status: 'ACTIVE' | 'CANCELLED';
  started_at: string;
  package: { id: string; name: string; price: number; currency: string; billing_cycle: 'MONTHLY' | 'ANNUAL' } | null;
} | null;

type PackageOption = { id: string; name: string; price: number; currency: string; billing_cycle: 'MONTHLY' | 'ANNUAL'; is_active: boolean };

type SubscriptionPreview = {
  currentPackage: { id: string; name: string; price: number } | null;
  targetPackage: { id: string; name: string; price: number; currency: string; billing_cycle: 'MONTHLY' | 'ANNUAL' };
  priceDifference: number;
  changeType: 'NEW' | 'UPGRADE' | 'DOWNGRADE' | 'LATERAL';
  modulesGained: { key: string; name: string }[];
  modulesLost: { key: string; name: string }[];
};

const CHANGE_TYPE_LABELS: Record<SubscriptionPreview['changeType'], string> = {
  NEW: 'New subscription',
  UPGRADE: 'Upgrade',
  DOWNGRADE: 'Downgrade',
  LATERAL: 'Lateral move',
};

function PackageSection({
  schoolId, subscription, packages, onUpdated,
}: {
  schoolId: string;
  subscription: Subscription;
  packages: PackageOption[];
  onUpdated: () => void;
}) {
  const [selected, setSelected] = useState('');
  const [preview, setPreview] = useState<SubscriptionPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [preserveKeys, setPreserveKeys] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function pickPackage(packageId: string) {
    setSelected(packageId);
    setPreview(null);
    setPreserveKeys(new Set());
    if (!packageId) return;
    setPreviewLoading(true);
    setErr('');
    try {
      const res = await apiFetch<SubscriptionPreview>(
        `/super-admin/schools/${schoolId}/subscription/preview?packageId=${packageId}`,
      );
      setPreview(res);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to preview package change');
    } finally {
      setPreviewLoading(false);
    }
  }

  function togglePreserve(key: string) {
    setPreserveKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  async function confirmChange() {
    if (!selected) return;
    setBusy(true);
    setErr('');
    try {
      await apiFetch(`/super-admin/schools/${schoolId}/subscription`, {
        method: 'POST',
        body: JSON.stringify({ packageId: selected, preserveModuleKeys: [...preserveKeys] }),
      });
      setSelected('');
      setPreview(null);
      setPreserveKeys(new Set());
      onUpdated();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to assign package');
    } finally {
      setBusy(false);
    }
  }

  function cancelPreview() {
    setSelected('');
    setPreview(null);
    setPreserveKeys(new Set());
  }

  return (
    <section>
      <h2 className="text-sm font-semibold text-slate-600 mb-3">Package</h2>
      {err && <p className="text-sm text-rose-600 bg-rose-50 rounded px-3 py-2 mb-3">{err}</p>}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        {subscription?.package ? (
          <div>
            <p className="font-semibold text-slate-800">{subscription.package.name}</p>
            <p className="text-sm text-slate-500">
              {subscription.package.currency} {subscription.package.price.toLocaleString()} /{subscription.package.billing_cycle === 'MONTHLY' ? 'mo' : 'yr'}
            </p>
            <p className="text-xs text-slate-400 mt-1">Since {new Date(subscription.started_at).toLocaleDateString()}</p>
          </div>
        ) : (
          <p className="text-sm text-slate-400">No package assigned yet.</p>
        )}

        {!preview && (
          <div className="border-t border-slate-100 pt-4">
            <select
              value={selected}
              onChange={(e) => pickPackage(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
            >
              <option value="">{subscription?.package ? 'Switch to…' : 'Assign a package…'}</option>
              {packages.filter((p) => p.is_active).map((p) => (
                <option key={p.id} value={p.id}>{p.name} — {p.currency} {p.price.toLocaleString()}</option>
              ))}
            </select>
            {previewLoading && <p className="text-xs text-slate-400 mt-2">Loading preview…</p>}
          </div>
        )}

        {preview && (
          <div className="border-t border-slate-100 pt-4 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-500">
                  {preview.currentPackage?.name ?? 'No package'} → <span className="font-semibold text-slate-800">{preview.targetPackage.name}</span>
                </p>
                <p className="text-xs text-slate-400 mt-0.5">
                  {preview.priceDifference === 0 ? 'Same price' : `${preview.priceDifference > 0 ? '+' : ''}${preview.targetPackage.currency} ${preview.priceDifference.toLocaleString()}`}
                </p>
              </div>
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-violet-50 text-violet-700">
                {CHANGE_TYPE_LABELS[preview.changeType]}
              </span>
            </div>

            {preview.modulesGained.length > 0 && (
              <div>
                <p className="text-xs font-medium text-emerald-700 mb-1">Gained ({preview.modulesGained.length})</p>
                <p className="text-sm text-slate-600">{preview.modulesGained.map((m) => m.name).join(', ')}</p>
              </div>
            )}

            {preview.modulesLost.length > 0 && (
              <div>
                <p className="text-xs font-medium text-rose-700 mb-1">Will become unavailable ({preview.modulesLost.length})</p>
                <div className="space-y-1">
                  {preview.modulesLost.map((m) => (
                    <label key={m.key} className="flex items-center gap-2 text-sm text-slate-700">
                      <input type="checkbox" checked={preserveKeys.has(m.key)} onChange={() => togglePreserve(m.key)} />
                      {m.name}
                      <span className="text-xs text-slate-400">— keep enabled via override</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {preview.modulesGained.length === 0 && preview.modulesLost.length === 0 && (
              <p className="text-sm text-slate-400">No change in module access.</p>
            )}

            <div className="flex items-center gap-2">
              <button
                onClick={confirmChange}
                disabled={busy}
                className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-700 disabled:opacity-50"
              >
                {busy ? '…' : 'Confirm change'}
              </button>
              <button
                onClick={cancelPreview}
                disabled={busy}
                className="px-4 py-2 rounded-lg text-sm font-medium border border-slate-200 hover:bg-slate-50 disabled:opacity-40"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

type CurriculumOption = { id: string; name: string; is_active: boolean };
type AssignedCurriculum = { id: string; name: string; description: string } | null;

function CurriculumSection({
  schoolId, curriculum, options, onUpdated,
}: {
  schoolId: string;
  curriculum: AssignedCurriculum;
  options: CurriculumOption[];
  onUpdated: () => void;
}) {
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function assign(curriculumId: string | null) {
    setBusy(true);
    setErr('');
    try {
      await apiFetch(`/super-admin/schools/${schoolId}/curriculum`, {
        method: 'POST',
        body: JSON.stringify({ curriculumId }),
      });
      setSelected('');
      onUpdated();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to update curriculum');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h2 className="text-sm font-semibold text-slate-600 mb-3">Curriculum</h2>
      {err && <p className="text-sm text-rose-600 bg-rose-50 rounded px-3 py-2 mb-3">{err}</p>}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        {curriculum ? (
          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold text-slate-800">{curriculum.name}</p>
              <p className="text-xs text-slate-400 mt-0.5">{curriculum.description || 'No description'}</p>
            </div>
            <button
              onClick={() => assign(null)}
              disabled={busy}
              className="text-xs text-slate-400 hover:text-rose-600 transition-colors disabled:opacity-40"
            >
              Clear
            </button>
          </div>
        ) : (
          <p className="text-sm text-slate-400">No curriculum tagged.</p>
        )}
        <div className="flex items-center gap-2 border-t border-slate-100 pt-4">
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm"
          >
            <option value="">{curriculum ? 'Switch to…' : 'Assign a curriculum…'}</option>
            {options.filter((c) => c.is_active).map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <button
            onClick={() => assign(selected)}
            disabled={!selected || busy}
            className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-700 disabled:opacity-50"
          >
            {busy ? '…' : 'Assign'}
          </button>
        </div>
      </div>
    </section>
  );
}

const STATUS_STYLES: Record<SchoolStatus, string> = {
  ACTIVE: 'bg-emerald-50 text-emerald-700',
  INACTIVE: 'bg-slate-100 text-slate-500',
  SUSPENDED: 'bg-amber-50 text-amber-700',
  ARCHIVED: 'bg-rose-50 text-rose-700',
};
const ALL_STATUSES: SchoolStatus[] = ['ACTIVE', 'INACTIVE', 'SUSPENDED', 'ARCHIVED'];

function SchoolProfileCard({ school, onUpdated }: { school: School; onUpdated: () => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(school.name);
  const [phone, setPhone] = useState(school.phone ?? '');
  const [email, setEmail] = useState(school.email ?? '');
  const [address, setAddress] = useState(school.address ?? '');
  const [saving, setSaving] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const [err, setErr] = useState('');

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErr('');
    try {
      await apiFetch(`/super-admin/schools/${school.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name, phone: phone || undefined, email: email || undefined, address: address || undefined }),
      });
      setEditing(false);
      onUpdated();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to update school');
    } finally {
      setSaving(false);
    }
  }

  async function changeStatus(next: SchoolStatus) {
    if (!confirm(`Change status to ${next}?`)) return;
    const reason = window.prompt('Reason (optional):') ?? undefined;
    setStatusBusy(true);
    setErr('');
    try {
      await apiFetch(`/super-admin/schools/${school.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: next, reason: reason || undefined }),
      });
      onUpdated();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to change status');
    } finally {
      setStatusBusy(false);
    }
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
      {err && <p className="text-sm text-rose-600 bg-rose-50 rounded px-3 py-2">{err}</p>}

      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold">{school.name}</h1>
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_STYLES[school.status]}`}>
              {school.status}
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">/{school.slug} · {school.timezone}</p>
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
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Phone</label>
              <input value={phone} onChange={(e) => setPhone(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Email</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Address</label>
            <input value={address} onChange={(e) => setAddress(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
          </div>
          <button type="submit" disabled={saving}
            className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-700 disabled:opacity-50">
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </form>
      ) : (
        <div className="grid grid-cols-2 gap-3 text-sm">
          <p><span className="text-slate-400">Phone</span> <br /> {school.phone ?? '—'}</p>
          <p><span className="text-slate-400">Email</span> <br /> {school.email ?? '—'}</p>
          <p className="col-span-2"><span className="text-slate-400">Address</span> <br /> {school.address ?? '—'}</p>
        </div>
      )}

      <div className="border-t border-slate-100 pt-4">
        <p className="text-xs font-medium text-slate-500 mb-2">Change status</p>
        <div className="flex flex-wrap gap-2">
          {ALL_STATUSES.filter((s) => s !== school.status).map((s) => (
            <button
              key={s}
              onClick={() => changeStatus(s)}
              disabled={statusBusy}
              className="px-3 py-1.5 rounded-lg text-xs font-medium border border-slate-200 hover:bg-slate-50 disabled:opacity-40 transition-colors"
            >
              Set {s}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

type InvoiceStatus = 'PENDING' | 'PAID' | 'OVERDUE' | 'CANCELLED';
type Invoice = {
  id: string;
  package_name: string;
  amount: number;
  currency: string;
  billing_cycle: 'MONTHLY' | 'ANNUAL';
  period_start: string;
  period_end: string;
  due_date: string;
  status: InvoiceStatus;
  paid_at: string | null;
  notes: string | null;
  created_at: string;
};

const INVOICE_STATUS_STYLES: Record<InvoiceStatus, string> = {
  PENDING: 'bg-slate-100 text-slate-500',
  PAID: 'bg-emerald-50 text-emerald-700',
  OVERDUE: 'bg-rose-50 text-rose-700',
  CANCELLED: 'bg-slate-100 text-slate-400',
};

function defaultInvoiceDates(billingCycle: 'MONTHLY' | 'ANNUAL') {
  const start = new Date();
  const end = new Date(start);
  if (billingCycle === 'MONTHLY') end.setMonth(end.getMonth() + 1);
  else end.setFullYear(end.getFullYear() + 1);
  const due = new Date(start);
  due.setDate(due.getDate() + 14);
  const toIso = (d: Date) => d.toISOString().slice(0, 10);
  return { periodStart: toIso(start), periodEnd: toIso(end), dueDate: toIso(due) };
}

function InvoicesSection({ schoolId, subscription }: { schoolId: string; subscription: Subscription }) {
  const { hasPermission } = usePlatformPermissions();
  const [invoices, setInvoices] = useState<Invoice[] | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState('');

  function load() {
    apiFetch<Invoice[]>(`/super-admin/billing/schools/${schoolId}/invoices`)
      .then(setInvoices)
      .catch((e) => setErr(e instanceof Error ? e.message : 'Failed to load invoices'));
  }

  useEffect(load, [schoolId]);

  function openForm() {
    const cycle = subscription?.package?.billing_cycle ?? 'MONTHLY';
    const defaults = defaultInvoiceDates(cycle);
    setPeriodStart(defaults.periodStart);
    setPeriodEnd(defaults.periodEnd);
    setDueDate(defaults.dueDate);
    setShowForm(true);
  }

  async function createInvoice(e: React.FormEvent) {
    e.preventDefault();
    setBusy('create');
    setErr('');
    try {
      await apiFetch(`/super-admin/billing/schools/${schoolId}/invoices`, {
        method: 'POST',
        body: JSON.stringify({ periodStart, periodEnd, dueDate, notes: notes || undefined }),
      });
      setShowForm(false);
      setNotes('');
      load();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Failed to generate invoice');
    } finally {
      setBusy(null);
    }
  }

  async function updateStatus(invoiceId: string, status: 'PAID' | 'CANCELLED') {
    if (!confirm(`Mark this invoice as ${status}?`)) return;
    setBusy(invoiceId);
    setErr('');
    try {
      await apiFetch(`/super-admin/billing/invoices/${invoiceId}`, { method: 'PATCH', body: JSON.stringify({ status }) });
      load();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Failed to update invoice');
    } finally {
      setBusy(null);
    }
  }

  if (!hasPermission('VIEW_BILLING')) return null;
  const canManage = hasPermission('MANAGE_BILLING');

  return (
    <section>
      <h2 className="text-sm font-semibold text-slate-600 mb-3">Invoices</h2>
      {err && <p className="text-sm text-rose-600 bg-rose-50 rounded px-3 py-2 mb-3">{err}</p>}

      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        {!subscription?.package ? (
          <p className="text-sm text-slate-400">Assign a package subscription before generating invoices.</p>
        ) : !canManage ? null : !showForm ? (
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm text-slate-400">Generate an invoice for the current {subscription.package.name} subscription.</p>
            <button onClick={openForm} className="px-3 py-1.5 rounded-lg text-xs font-medium border border-slate-200 hover:bg-slate-50 shrink-0">
              Generate invoice
            </button>
          </div>
        ) : (
          <form onSubmit={createInvoice} className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Period start</label>
                <input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} required className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Period end</label>
                <input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} required className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Due date</label>
                <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} required className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Notes (optional)</label>
              <input value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div className="flex items-center gap-2">
              <button
                type="submit"
                disabled={busy === 'create'}
                className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-700 disabled:opacity-50"
              >
                {busy === 'create' ? '…' : `Generate ${subscription.package.currency} ${subscription.package.price.toLocaleString()} invoice`}
              </button>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                disabled={busy === 'create'}
                className="px-4 py-2 rounded-lg text-sm font-medium border border-slate-200 hover:bg-slate-50 disabled:opacity-40"
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {invoices && invoices.length > 0 && (
          <div className="border-t border-slate-100 pt-4">
            <div className="bg-white border border-slate-100 rounded-xl overflow-hidden overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="text-left px-4 py-2 font-medium text-slate-500 text-xs">Period</th>
                    <th className="text-left px-4 py-2 font-medium text-slate-500 text-xs">Amount</th>
                    <th className="text-left px-4 py-2 font-medium text-slate-500 text-xs">Due</th>
                    <th className="text-left px-4 py-2 font-medium text-slate-500 text-xs">Status</th>
                    {canManage && <th className="text-right px-4 py-2 font-medium text-slate-500 text-xs">Actions</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {invoices.map((inv) => (
                    <tr key={inv.id}>
                      <td className="px-4 py-2 text-slate-600 text-xs whitespace-nowrap">{inv.period_start} → {inv.period_end}</td>
                      <td className="px-4 py-2 text-slate-700">{inv.currency} {Number(inv.amount).toLocaleString()}</td>
                      <td className="px-4 py-2 text-slate-500 text-xs">{new Date(inv.due_date).toLocaleDateString()}</td>
                      <td className="px-4 py-2">
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${INVOICE_STATUS_STYLES[inv.status]}`}>{inv.status}</span>
                      </td>
                      {canManage && (
                        <td className="px-4 py-2 text-right">
                          {(inv.status === 'PENDING' || inv.status === 'OVERDUE') && (
                            <div className="flex justify-end gap-2">
                              <button onClick={() => updateStatus(inv.id, 'PAID')} disabled={busy === inv.id} className="text-xs font-medium text-emerald-700 hover:underline disabled:opacity-40">
                                Mark paid
                              </button>
                              <button onClick={() => updateStatus(inv.id, 'CANCELLED')} disabled={busy === inv.id} className="text-xs font-medium text-slate-400 hover:text-rose-600 disabled:opacity-40">
                                Cancel
                              </button>
                            </div>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function PrivilegedAccessSection({ school }: { school: School }) {
  const { hasPermission } = usePlatformPermissions();
  const router = useRouter();
  const [activeGrant, setActiveGrant] = useState<PrivilegedAccessGrant | null>(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [reason, setReason] = useState('');
  const [reference, setReference] = useState('');
  const [scopes, setScopes] = useState<Set<PrivilegedAccessScope>>(new Set());
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [entering, setEntering] = useState(false);

  useEffect(() => {
    apiFetch<PrivilegedAccessGrant | null>('/super-admin/privileged-access/grants/active')
      .then(setActiveGrant)
      .catch(() => setActiveGrant(null))
      .finally(() => setLoading(false));
  }, []);

  async function enterAssistMode(grantId: string) {
    setEntering(true);
    setErr('');
    try {
      const result = await apiFetch<{ token: string; expiresAt: string }>(
        `/super-admin/privileged-access/grants/${grantId}/enter-assist`,
        { method: 'POST' },
      );
      const res = await fetch('/api/assist-mode/enter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: result.token, expiresAt: result.expiresAt }),
      });
      if (!res.ok) throw new Error('Failed to start assist mode session');
      window.location.href = '/admin';
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to enter assist mode');
      setEntering(false);
    }
  }

  function toggleScope(scope: PrivilegedAccessScope) {
    setScopes((prev) => {
      const next = new Set(prev);
      if (next.has(scope)) next.delete(scope); else next.add(scope);
      return next;
    });
  }

  async function requestAccess(e: React.FormEvent) {
    e.preventDefault();
    if (scopes.size === 0) { setErr('Select at least one scope'); return; }
    setBusy(true);
    setErr('');
    try {
      const grant = await apiFetch<PrivilegedAccessGrant>('/super-admin/privileged-access/grants', {
        method: 'POST',
        body: JSON.stringify({
          schoolId: school.id,
          reason,
          reference: reference || undefined,
          scopes: [...scopes],
          durationMinutes,
        }),
      });
      notifyPrivilegedAccessChanged();
      router.push(`/super-admin/privileged-access/${grant.id}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to request privileged access');
    } finally {
      setBusy(false);
    }
  }

  if (!hasPermission('GRANT_PRIVILEGED_ACCESS')) return null;

  const activeForThisSchool = activeGrant && activeGrant.targetSchoolId === school.id;

  return (
    <section>
      <h2 className="text-sm font-semibold text-slate-600 mb-3">Privileged access</h2>
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        {err && <p className="text-sm text-rose-600 bg-rose-50 rounded px-3 py-2">{err}</p>}

        {loading ? (
          <p className="text-sm text-slate-400">Loading…</p>
        ) : activeForThisSchool && activeGrant ? (
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-700">Active session — expires in {formatRemaining(activeGrant.expiresAt)}</p>
              <p className="text-xs text-slate-400 mt-0.5">{activeGrant.reason}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => enterAssistMode(activeGrant.id)}
                disabled={entering}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-500 text-amber-950 hover:bg-amber-400 disabled:opacity-50"
              >
                {entering ? 'Entering…' : 'Enter assist mode →'}
              </button>
              <Link
                href={`/super-admin/privileged-access/${activeGrant.id}`}
                className="px-3 py-1.5 rounded-lg text-xs font-medium border border-slate-200 hover:bg-slate-50"
              >
                View session
              </Link>
            </div>
          </div>
        ) : !showForm ? (
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm text-slate-400">Request temporary, scoped, read-only access to this school&apos;s tenant data.</p>
            <button
              onClick={() => setShowForm(true)}
              className="px-3 py-1.5 rounded-lg text-xs font-medium border border-slate-200 hover:bg-slate-50 shrink-0"
            >
              Request access
            </button>
          </div>
        ) : (
          <form onSubmit={requestAccess} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Reason</label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                required
                rows={2}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                placeholder="e.g. Investigating support ticket — grades not showing for Grade 6"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Reference (optional)</label>
              <input
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                placeholder="Support ticket ID, etc."
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Scopes</label>
              <div className="space-y-1">
                {(Object.keys(PRIVILEGED_ACCESS_SCOPE_LABELS) as PrivilegedAccessScope[]).map((scope) => {
                  const wired = PRIVILEGED_ACCESS_WIRED_SCOPES.includes(scope);
                  return (
                    <label key={scope} className={`flex items-center gap-2 text-sm ${wired ? 'text-slate-700' : 'text-slate-400'}`}>
                      <input type="checkbox" checked={scopes.has(scope)} onChange={() => toggleScope(scope)} disabled={!wired} />
                      {PRIVILEGED_ACCESS_SCOPE_LABELS[scope]}
                      {!wired && <span className="text-xs">— coming soon</span>}
                    </label>
                  );
                })}
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Duration</label>
              <select
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(Number(e.target.value))}
                className="border border-slate-200 rounded-lg px-3 py-2 text-sm"
              >
                <option value={30}>30 minutes</option>
                <option value={60}>1 hour</option>
                <option value={240}>4 hours</option>
                <option value={1440}>24 hours</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <button type="submit" disabled={busy}
                className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-700 disabled:opacity-50">
                {busy ? '…' : 'Request access'}
              </button>
              <button type="button" onClick={() => setShowForm(false)} disabled={busy}
                className="px-4 py-2 rounded-lg text-sm font-medium border border-slate-200 hover:bg-slate-50 disabled:opacity-40">
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </section>
  );
}

export default function SchoolDetailPage() {
  const params = useParams<{ schoolId: string }>();
  const schoolId = params.schoolId;
  const { hasPermission } = usePlatformPermissions();

  const [school, setSchool] = useState<School | null>(null);
  const [overview, setOverview] = useState<SchoolOverview | null>(null);
  const [modules, setModules] = useState<ModuleRow[]>([]);
  const [subscription, setSubscription] = useState<Subscription>(null);
  const [packages, setPackages] = useState<PackageOption[]>([]);
  const [curriculum, setCurriculum] = useState<AssignedCurriculum>(null);
  const [curriculumOptions, setCurriculumOptions] = useState<CurriculumOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);

  function load() {
    setLoading(true);
    Promise.all([
      apiFetch<School>(`/super-admin/schools/${schoolId}`),
      apiFetch<SchoolOverview>(`/super-admin/schools/${schoolId}/overview`),
      apiFetch<ModuleRow[]>(`/super-admin/schools/${schoolId}/modules`),
      apiFetch<Subscription>(`/super-admin/schools/${schoolId}/subscription`),
      apiFetch<PackageOption[]>('/super-admin/packages'),
      apiFetch<AssignedCurriculum>(`/super-admin/schools/${schoolId}/curriculum`),
      apiFetch<CurriculumOption[]>('/super-admin/curricula'),
    ])
      .then(([s, o, m, sub, pkgs, curr, currOpts]) => {
        setSchool(s); setOverview(o); setModules(m); setSubscription(sub); setPackages(pkgs);
        setCurriculum(curr); setCurriculumOptions(currOpts);
      })
      .catch((e) => setErr(e instanceof Error ? e.message : 'Failed to load school'))
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
      <div className="flex items-center justify-between">
        <BackButton href="/super-admin/schools" />
        {hasPermission('VIEW_AUDIT_LOGS') && (
          <Link href={`/super-admin/audit?schoolId=${schoolId}`} className="text-sm text-slate-500 hover:text-slate-900 transition-colors">
            View audit trail →
          </Link>
        )}
      </div>

      {err && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{err}</p>}
      {warnings.length > 0 && (
        <div className="text-sm text-amber-700 bg-amber-50 rounded-lg px-3 py-2 space-y-1">
          {warnings.map((w) => <p key={w}>⚠ {w}</p>)}
        </div>
      )}

      {loading || !school ? (
        <p className="text-sm text-slate-400 text-center py-10">Loading…</p>
      ) : (
        <>
          <SchoolProfileCard school={school} onUpdated={load} />

          <PrivilegedAccessSection school={school} />

          <PackageSection schoolId={schoolId} subscription={subscription} packages={packages} onUpdated={load} />

          <InvoicesSection schoolId={schoolId} subscription={subscription} />

          <CurriculumSection schoolId={schoolId} curriculum={curriculum} options={curriculumOptions} onUpdated={load} />

          {overview && (
            <>
              <section>
                <h2 className="text-sm font-semibold text-slate-600 mb-3">User statistics</h2>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-3">
                  <StatCard label="Total users" value={overview.users.total} />
                  <StatCard label="Active" value={overview.users.active} accent="text-emerald-600" />
                  <StatCard label="Inactive" value={overview.users.inactive} accent="text-slate-400" />
                  <StatCard label="New this month" value={overview.users.newThisMonth} accent="text-violet-600" />
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <StatCard label="Admins" value={overview.users.byRole.ADMIN} />
                  <StatCard label="Teachers" value={overview.users.byRole.TEACHER} />
                  <StatCard label="Students" value={overview.users.byRole.STUDENT} />
                  <StatCard label="Parents" value={overview.users.byRole.PARENT} />
                </div>
              </section>

              <section>
                <h2 className="text-sm font-semibold text-slate-600 mb-3">Academic overview</h2>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-3">
                  <StatCard label="Classes" value={overview.academic.classCount} />
                  <StatCard label="Subjects" value={overview.academic.subjectCount} />
                  <StatCard label="Assessments (30d)" value={overview.academic.assessmentsCreatedLast30Days} />
                  <StatCard label="Grades recorded (30d)" value={overview.academic.gradesRecordedLast30Days} />
                </div>
                <div className="bg-white border border-slate-200 rounded-xl px-5 py-4 mb-3">
                  <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Attendance rate (30d)</p>
                  <p className="text-3xl font-bold mt-1 text-slate-800">
                    {overview.academic.attendance.presentRate != null ? `${overview.academic.attendance.presentRate}%` : '—'}
                  </p>
                  <p className="text-xs text-slate-400 mt-1">{overview.academic.attendance.recordCount} records</p>
                </div>
                {Object.keys(overview.academic.studentsPerGrade).length > 0 && (
                  <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 border-b border-slate-200">
                        <tr>
                          <th className="text-left px-4 py-2 font-medium text-slate-500 text-xs">Grade</th>
                          <th className="text-right px-4 py-2 font-medium text-slate-500 text-xs">Students</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {Object.entries(overview.academic.studentsPerGrade)
                          .sort(([a], [b]) => Number(a) - Number(b))
                          .map(([grade, count]) => (
                            <tr key={grade}>
                              <td className="px-4 py-2 text-slate-700">Grade {grade}</td>
                              <td className="px-4 py-2 text-right text-slate-800 font-medium">{count}</td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              <section>
                <h2 className="text-sm font-semibold text-slate-600 mb-3">Engagement</h2>
                <p className="text-xs text-slate-400 mb-3">Based on real login activity, not a fabricated score.</p>
                <div className="grid grid-cols-3 gap-4 mb-3">
                  <StatCard label="Daily active" value={overview.engagement.dau} />
                  <StatCard label="Weekly active" value={overview.engagement.wau} />
                  <StatCard label="Monthly active" value={overview.engagement.mau} />
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <StatCard label="Admin logins (7d)" value={overview.engagement.loginsByRoleLast7Days.ADMIN} />
                  <StatCard label="Teacher logins (7d)" value={overview.engagement.loginsByRoleLast7Days.TEACHER} />
                  <StatCard label="Student logins (7d)" value={overview.engagement.loginsByRoleLast7Days.STUDENT} />
                  <StatCard label="Parent logins (7d)" value={overview.engagement.loginsByRoleLast7Days.PARENT} />
                </div>
              </section>
            </>
          )}

          <div>
            <h2 className="text-lg font-semibold mb-1">Modules</h2>
            <p className="text-sm text-slate-500 mb-4">Enable or disable features for this school. Disabling never deletes data.</p>

            {Object.entries(byCategory).map(([category, mods]) => (
              <div key={category} className="space-y-2 mb-4">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">{category}</h3>
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
                        <span className="text-xs text-slate-400">{SOURCE_LABELS[m.entitlementSource]}</span>
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
            ))}
          </div>
        </>
      )}
    </div>
  );
}
