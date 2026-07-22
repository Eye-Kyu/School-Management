'use client';

import { useEffect, useState } from 'react';
import { apiFetch, ApiError } from '@/lib/api';
import type { PlatformPermission } from '@school-manager/types';

const ALL_PERMISSIONS: PlatformPermission[] = [
  'VIEW_SCHOOLS', 'MANAGE_SCHOOLS',
  'VIEW_MODULES', 'MANAGE_MODULES',
  'VIEW_PACKAGES', 'MANAGE_PACKAGES',
  'VIEW_CURRICULUM', 'MANAGE_CURRICULUM',
  'VIEW_PLATFORM_USERS', 'MANAGE_PLATFORM_USERS',
  'VIEW_BILLING', 'MANAGE_BILLING',
  'VIEW_PLATFORM_ANALYTICS', 'VIEW_AUDIT_LOGS',
  'GRANT_PRIVILEGED_ACCESS', 'VIEW_SYSTEM_HEALTH', 'MANAGE_PLATFORM_SETTINGS',
];

const PERMISSION_LABELS: Record<PlatformPermission, string> = {
  VIEW_SCHOOLS: 'View schools', MANAGE_SCHOOLS: 'Manage schools',
  VIEW_MODULES: 'View modules', MANAGE_MODULES: 'Manage modules',
  VIEW_PACKAGES: 'View packages', MANAGE_PACKAGES: 'Manage packages',
  VIEW_CURRICULUM: 'View curriculum', MANAGE_CURRICULUM: 'Manage curriculum',
  VIEW_PLATFORM_USERS: 'View platform users', MANAGE_PLATFORM_USERS: 'Manage platform users',
  VIEW_BILLING: 'View billing', MANAGE_BILLING: 'Manage billing',
  VIEW_PLATFORM_ANALYTICS: 'View analytics', VIEW_AUDIT_LOGS: 'View audit logs',
  GRANT_PRIVILEGED_ACCESS: 'Grant privileged access', VIEW_SYSTEM_HEALTH: 'View system health',
  MANAGE_PLATFORM_SETTINGS: 'Manage platform settings',
};

type TenantUser = {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  role: 'ADMIN' | 'TEACHER' | 'STUDENT' | 'PARENT';
  is_active: boolean;
  created_at: string;
  school: { id: string; name: string } | null;
};

type SearchResult = { rows: TenantUser[]; total: number; page: number; pageSize: number };

type SuperAdminAccount = {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  platform_permissions: PlatformPermission[];
  is_active: boolean;
  created_at: string;
};

function UserSearchSection() {
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [role, setRole] = useState('');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => { setPage(1); }, [role, debouncedQ]);

  useEffect(() => {
    setLoading(true);
    setErr('');
    const params = new URLSearchParams();
    if (debouncedQ) params.set('q', debouncedQ);
    if (role) params.set('role', role);
    params.set('page', String(page));
    apiFetch<SearchResult>(`/super-admin/platform-users?${params.toString()}`)
      .then(setResult)
      .catch((e) => setErr(e instanceof Error ? e.message : 'Failed to search users'))
      .finally(() => setLoading(false));
  }, [debouncedQ, role, page]);

  async function toggleStatus(u: TenantUser) {
    if (!confirm(`${u.is_active ? 'Deactivate' : 'Reactivate'} ${u.full_name}?`)) return;
    setBusyId(u.id);
    setErr('');
    try {
      await apiFetch(`/super-admin/platform-users/${u.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !u.is_active }),
      });
      setResult((prev) => prev ? { ...prev, rows: prev.rows.map((r) => r.id === u.id ? { ...r, is_active: !u.is_active } : r) } : prev);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Failed to update user status');
    } finally {
      setBusyId(null);
    }
  }

  const totalPages = result ? Math.max(1, Math.ceil(result.total / result.pageSize)) : 1;

  return (
    <section>
      <h2 className="text-sm font-semibold text-slate-600 mb-3">Search users</h2>
      <p className="text-xs text-slate-400 mb-3">Cross-tenant search across every school, for support and operations.</p>

      <div className="bg-white border border-slate-200 rounded-xl p-4 mb-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by name, email, or phone…"
          className="col-span-2 sm:col-span-3 border border-slate-200 rounded-lg px-3 py-2 text-sm"
        />
        <select value={role} onChange={(e) => setRole(e.target.value)} className="border border-slate-200 rounded-lg px-3 py-2 text-sm">
          <option value="">All roles</option>
          <option value="ADMIN">Admin</option>
          <option value="TEACHER">Teacher</option>
          <option value="STUDENT">Student</option>
          <option value="PARENT">Parent</option>
        </select>
      </div>

      {err && <p className="text-sm text-red-600 mb-3">{err}</p>}

      {loading && !result ? (
        <p className="text-sm text-slate-400 text-center py-6">Loading…</p>
      ) : !result || result.rows.length === 0 ? (
        <p className="text-sm text-slate-400 bg-white border border-dashed border-slate-200 rounded-xl px-5 py-6 text-center">
          No matching users.
        </p>
      ) : (
        <>
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="text-left px-4 py-2 font-medium text-slate-500 text-xs">Name</th>
                  <th className="text-left px-4 py-2 font-medium text-slate-500 text-xs">Contact</th>
                  <th className="text-left px-4 py-2 font-medium text-slate-500 text-xs">Role</th>
                  <th className="text-left px-4 py-2 font-medium text-slate-500 text-xs">School</th>
                  <th className="text-left px-4 py-2 font-medium text-slate-500 text-xs">Status</th>
                  <th className="text-right px-4 py-2 font-medium text-slate-500 text-xs">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {result.rows.map((u) => (
                  <tr key={u.id}>
                    <td className="px-4 py-2 text-slate-800 font-medium">{u.full_name}</td>
                    <td className="px-4 py-2 text-slate-500 text-xs">{u.email ?? u.phone ?? '—'}</td>
                    <td className="px-4 py-2 text-slate-600 text-xs">{u.role}</td>
                    <td className="px-4 py-2 text-slate-600">{u.school?.name ?? '—'}</td>
                    <td className="px-4 py-2">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${u.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                        {u.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button
                        onClick={() => toggleStatus(u)}
                        disabled={busyId === u.id}
                        className="text-xs font-medium text-slate-500 hover:text-rose-600 disabled:opacity-40"
                      >
                        {busyId === u.id ? '…' : u.is_active ? 'Deactivate' : 'Reactivate'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between mt-3">
            <p className="text-xs text-slate-400">Page {result.page} of {totalPages} ({result.total} results)</p>
            <div className="flex gap-2">
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1 || loading}
                className="px-3 py-1.5 rounded-lg text-xs font-medium border border-slate-200 hover:bg-slate-50 disabled:opacity-40">
                Previous
              </button>
              <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages || loading}
                className="px-3 py-1.5 rounded-lg text-xs font-medium border border-slate-200 hover:bg-slate-50 disabled:opacity-40">
                Next
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function SuperAdminCard({ admin, onUpdated }: { admin: SuperAdminAccount; onUpdated: () => void }) {
  const [editing, setEditing] = useState(false);
  const [permissions, setPermissions] = useState<Set<PlatformPermission>>(new Set(admin.platform_permissions));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  function toggle(p: PlatformPermission) {
    setPermissions((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p); else next.add(p);
      return next;
    });
  }

  async function save() {
    setSaving(true);
    setErr('');
    try {
      await apiFetch(`/super-admin/platform-users/super-admins/${admin.id}/permissions`, {
        method: 'PATCH',
        body: JSON.stringify({ permissions: [...permissions] }),
      });
      setEditing(false);
      onUpdated();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Failed to update permissions');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
      {err && <p className="text-sm text-rose-600 bg-rose-50 rounded px-3 py-2">{err}</p>}
      <div className="flex items-center justify-between">
        <div>
          <p className="font-semibold text-slate-800">{admin.full_name}</p>
          <p className="text-xs text-slate-400 mt-0.5">{admin.email ?? admin.phone ?? '—'}</p>
        </div>
        <button
          onClick={() => setEditing((v) => !v)}
          className="px-3 py-1.5 rounded-lg text-xs font-medium border border-slate-200 hover:bg-slate-50"
        >
          {editing ? 'Cancel' : 'Edit permissions'}
        </button>
      </div>

      {!editing ? (
        <p className="text-xs text-slate-500">
          {admin.platform_permissions.length === ALL_PERMISSIONS.length
            ? 'All permissions'
            : admin.platform_permissions.length === 0
              ? 'No permissions'
              : admin.platform_permissions.map((p) => PERMISSION_LABELS[p]).join(', ')}
        </p>
      ) : (
        <div className="space-y-2 border-t border-slate-100 pt-3">
          <div className="grid grid-cols-2 gap-1.5">
            {ALL_PERMISSIONS.map((p) => (
              <label key={p} className="flex items-center gap-2 text-xs text-slate-700">
                <input type="checkbox" checked={permissions.has(p)} onChange={() => toggle(p)} />
                {PERMISSION_LABELS[p]}
              </label>
            ))}
          </div>
          <button
            onClick={save}
            disabled={saving}
            className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-700 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save permissions'}
          </button>
        </div>
      )}
    </div>
  );
}

function SuperAdminsSection() {
  const [admins, setAdmins] = useState<SuperAdminAccount[] | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [creating, setCreating] = useState(false);
  const [createdCreds, setCreatedCreds] = useState<{ email: string | null; phone: string | null; temporaryPassword: string } | null>(null);
  const [err, setErr] = useState('');

  function load() {
    apiFetch<SuperAdminAccount[]>('/super-admin/platform-users/super-admins')
      .then(setAdmins)
      .catch((e) => setErr(e instanceof Error ? e.message : 'Failed to load platform administrators'));
  }

  useEffect(load, []);

  async function createSuperAdmin(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setErr('');
    try {
      const res = await apiFetch<{ email: string | null; phone: string | null; temporaryPassword: string }>(
        '/super-admin/platform-users/super-admins',
        { method: 'POST', body: JSON.stringify({ fullName, email: email || undefined, phone: phone || undefined }) },
      );
      setCreatedCreds(res);
      setFullName(''); setEmail(''); setPhone(''); setShowForm(false);
      load();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Failed to create SUPER_ADMIN');
    } finally {
      setCreating(false);
    }
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-slate-600">Platform administrators</h2>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="px-3 py-1.5 rounded-lg text-xs font-medium border border-slate-200 hover:bg-slate-50"
        >
          {showForm ? 'Cancel' : '+ Create SUPER_ADMIN'}
        </button>
      </div>

      {err && <p className="text-sm text-rose-600 bg-rose-50 rounded px-3 py-2 mb-3">{err}</p>}

      {createdCreds && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-3 text-sm">
          <p className="font-medium text-amber-900">SUPER_ADMIN created — save this password now, it won&apos;t be shown again:</p>
          <p className="text-amber-800 mt-1">
            {createdCreds.email ?? createdCreds.phone} · <span className="font-mono">{createdCreds.temporaryPassword}</span>
          </p>
          <button onClick={() => setCreatedCreds(null)} className="text-xs text-amber-700 hover:underline mt-1">Dismiss</button>
        </div>
      )}

      {showForm && (
        <form onSubmit={createSuperAdmin} className="bg-white border border-slate-200 rounded-xl p-4 grid grid-cols-2 sm:grid-cols-3 gap-3 mb-3">
          <div className="col-span-2 sm:col-span-1">
            <label className="block text-xs font-medium text-slate-500 mb-1">Full name</label>
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} required className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Phone</label>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
          </div>
          <div className="col-span-2 sm:col-span-3 flex items-end">
            <button type="submit" disabled={creating} className="rounded-lg bg-slate-900 text-white px-4 py-2 text-sm font-medium hover:bg-slate-700 disabled:opacity-50">
              {creating ? 'Creating…' : 'Create'}
            </button>
          </div>
        </form>
      )}

      {!admins ? (
        <p className="text-sm text-slate-400 text-center py-6">Loading…</p>
      ) : (
        <div className="space-y-3">
          {admins.map((a) => <SuperAdminCard key={a.id} admin={a} onUpdated={load} />)}
        </div>
      )}
    </section>
  );
}

export default function PlatformUsersPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Users</h1>
        <p className="text-sm text-slate-500 mt-0.5">Cross-tenant user search and platform administrator management.</p>
      </div>
      <UserSearchSection />
      <SuperAdminsSection />
    </div>
  );
}
