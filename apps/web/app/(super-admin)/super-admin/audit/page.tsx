'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { AUDIT_LOG_ACTIONS, AUDIT_LOG_ENTITY_TYPES } from '@school-manager/types';
import { PRIVILEGED_ACCESS_SCOPE_LABELS, type PrivilegedAccessGrant } from '@/lib/privilegedAccess';

const STATUS_STYLES: Record<PrivilegedAccessGrant['status'], string> = {
  ACTIVE: 'bg-emerald-50 text-emerald-700',
  ENDED: 'bg-slate-100 text-slate-500',
  EXPIRED: 'bg-amber-50 text-amber-700',
};

const ACTION_LABELS: Record<string, string> = Object.fromEntries(AUDIT_LOG_ACTIONS.map((a) => [a.action, a.label]));

type AuditLogRow = {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  user: { id: string; full_name: string; email: string | null; role: string } | null;
  school: { id: string; name: string } | null;
};

type AuditLogResponse = { rows: AuditLogRow[]; total: number; page: number; pageSize: number };

function AuditLogSection() {
  const searchParams = useSearchParams();
  const urlSchoolId = searchParams.get('schoolId');

  const [action, setAction] = useState('');
  const [entityType, setEntityType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [schoolId, setSchoolId] = useState(urlSchoolId ?? '');
  const [schoolName, setSchoolName] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<AuditLogResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    setPage(1);
  }, [action, entityType, from, to, debouncedQ, schoolId]);

  useEffect(() => {
    setLoading(true);
    setErr('');
    const params = new URLSearchParams();
    if (action) params.set('action', action);
    if (entityType) params.set('entityType', entityType);
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (debouncedQ) params.set('q', debouncedQ);
    if (schoolId) params.set('schoolId', schoolId);
    params.set('page', String(page));
    apiFetch<AuditLogResponse>(`/super-admin/audit-logs?${params.toString()}`)
      .then(setResult)
      .catch((e) => setErr(e instanceof Error ? e.message : 'Failed to load audit log'))
      .finally(() => setLoading(false));
  }, [action, entityType, from, to, debouncedQ, schoolId, page]);

  useEffect(() => {
    if (!urlSchoolId) return;
    apiFetch<{ name: string }>(`/super-admin/schools/${urlSchoolId}`)
      .then((s) => setSchoolName(s.name))
      .catch(() => setSchoolName(null));
  }, [urlSchoolId]);

  function clearFilters() {
    setAction('');
    setEntityType('');
    setFrom('');
    setTo('');
    setQ('');
    setSchoolId('');
    setSchoolName(null);
  }

  const totalPages = result ? Math.max(1, Math.ceil(result.total / result.pageSize)) : 1;
  const hasFilters = !!(action || entityType || from || to || q || schoolId);

  return (
    <section>
      <h2 className="text-sm font-semibold text-slate-600 mb-3">Full audit log</h2>

      {schoolId && schoolName && (
        <div className="flex items-center gap-2 mb-3 text-xs">
          <span className="px-2 py-1 rounded-full bg-violet-50 text-violet-700 font-medium">Filtered by: {schoolName}</span>
          <button onClick={() => { setSchoolId(''); setSchoolName(null); }} className="text-slate-400 hover:text-slate-700">
            Clear
          </button>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl p-4 mb-3 space-y-3">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <select value={action} onChange={(e) => setAction(e.target.value)} className="border border-slate-200 rounded-lg px-3 py-2 text-sm">
            <option value="">All actions</option>
            {AUDIT_LOG_ACTIONS.map((a) => (
              <option key={a.action} value={a.action}>{a.label}</option>
            ))}
          </select>
          <select value={entityType} onChange={(e) => setEntityType(e.target.value)} className="border border-slate-200 rounded-lg px-3 py-2 text-sm">
            <option value="">All entity types</option>
            {AUDIT_LOG_ENTITY_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="border border-slate-200 rounded-lg px-3 py-2 text-sm" />
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="border border-slate-200 rounded-lg px-3 py-2 text-sm" />
        </div>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by actor, school, or action…"
          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
        />
        {hasFilters && (
          <button onClick={clearFilters} className="text-xs text-slate-400 hover:text-rose-600">
            Clear filters
          </button>
        )}
      </div>

      {err && <p className="text-sm text-red-600 mb-3">{err}</p>}

      {loading && !result ? (
        <p className="text-sm text-slate-400 text-center py-6">Loading…</p>
      ) : !result || result.rows.length === 0 ? (
        <p className="text-sm text-slate-400 bg-white border border-dashed border-slate-200 rounded-xl px-5 py-6 text-center">
          No matching audit log entries.
        </p>
      ) : (
        <>
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="text-left px-4 py-2 font-medium text-slate-500 text-xs">When</th>
                  <th className="text-left px-4 py-2 font-medium text-slate-500 text-xs">Who</th>
                  <th className="text-left px-4 py-2 font-medium text-slate-500 text-xs">Action</th>
                  <th className="text-left px-4 py-2 font-medium text-slate-500 text-xs">Entity</th>
                  <th className="text-left px-4 py-2 font-medium text-slate-500 text-xs">School</th>
                  <th className="text-left px-4 py-2 font-medium text-slate-500 text-xs">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {result.rows.map((r) => (
                  <tr key={r.id}>
                    <td className="px-4 py-2 text-slate-500 text-xs whitespace-nowrap">{new Date(r.created_at).toLocaleString()}</td>
                    <td className="px-4 py-2 text-slate-700">
                      {r.user ? (
                        <>
                          {r.user.full_name} <span className="text-xs text-slate-400">({r.user.role})</span>
                        </>
                      ) : (
                        <span className="text-slate-400">System</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-slate-700">{ACTION_LABELS[r.action] ?? r.action}</td>
                    <td className="px-4 py-2 text-slate-500 text-xs">{r.entity_type}</td>
                    <td className="px-4 py-2 text-slate-600">{r.school?.name ?? '—'}</td>
                    <td
                      className="px-4 py-2 text-slate-400 text-xs max-w-xs truncate"
                      title={r.metadata ? JSON.stringify(r.metadata) : ''}
                    >
                      {r.metadata && Object.keys(r.metadata).length > 0 ? JSON.stringify(r.metadata) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between mt-3">
            <p className="text-xs text-slate-400">
              Page {result.page} of {totalPages} ({result.total} results)
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1 || loading}
                className="px-3 py-1.5 rounded-lg text-xs font-medium border border-slate-200 hover:bg-slate-50 disabled:opacity-40"
              >
                Previous
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages || loading}
                className="px-3 py-1.5 rounded-lg text-xs font-medium border border-slate-200 hover:bg-slate-50 disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

export default function AuditSecurityPage() {
  const [grants, setGrants] = useState<PrivilegedAccessGrant[] | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    apiFetch<PrivilegedAccessGrant[]>('/super-admin/privileged-access/grants')
      .then(setGrants)
      .catch((e) => setErr(e instanceof Error ? e.message : 'Failed to load privileged access sessions'));
  }, []);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Audit & Security</h1>
        <p className="text-sm text-slate-500 mt-0.5">Every privileged tenant-access session, fully attributed and time-boxed.</p>
      </div>

      <section>
        <h2 className="text-sm font-semibold text-slate-600 mb-3">Privileged access sessions</h2>
        {err && <p className="text-sm text-red-600 mb-3">{err}</p>}
        {!grants ? (
          <p className="text-sm text-slate-400 text-center py-6">Loading…</p>
        ) : grants.length === 0 ? (
          <p className="text-sm text-slate-400 bg-white border border-dashed border-slate-200 rounded-xl px-5 py-6 text-center">
            No privileged access has ever been granted.
          </p>
        ) : (
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="text-left px-4 py-2 font-medium text-slate-500 text-xs">School</th>
                  <th className="text-left px-4 py-2 font-medium text-slate-500 text-xs">Reason</th>
                  <th className="text-left px-4 py-2 font-medium text-slate-500 text-xs">Scopes</th>
                  <th className="text-left px-4 py-2 font-medium text-slate-500 text-xs">Status</th>
                  <th className="text-left px-4 py-2 font-medium text-slate-500 text-xs">Requested</th>
                  <th className="text-left px-4 py-2 font-medium text-slate-500 text-xs">Expires / ended</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {grants.map((g) => (
                  <tr key={g.id}>
                    <td className="px-4 py-2 text-slate-700">{g.schoolName ?? '—'}</td>
                    <td className="px-4 py-2 text-slate-600 max-w-xs truncate" title={g.reason}>{g.reason}</td>
                    <td className="px-4 py-2 text-slate-500 text-xs">{g.scopes.map((s) => PRIVILEGED_ACCESS_SCOPE_LABELS[s]).join(', ')}</td>
                    <td className="px-4 py-2">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_STYLES[g.status]}`}>{g.status}</span>
                    </td>
                    <td className="px-4 py-2 text-slate-500 text-xs">{new Date(g.createdAt).toLocaleString()}</td>
                    <td className="px-4 py-2 text-slate-500 text-xs">
                      {g.status === 'ENDED' && g.endedAt ? new Date(g.endedAt).toLocaleString() : new Date(g.expiresAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Suspense fallback={<p className="text-sm text-slate-400 text-center py-6">Loading…</p>}>
        <AuditLogSection />
      </Suspense>
    </div>
  );
}
