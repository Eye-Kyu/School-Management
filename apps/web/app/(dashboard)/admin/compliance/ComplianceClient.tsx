'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { apiFetch } from '@/lib/api';

type DeletionReq = { id: string; status: string; reason: string | null; created_at: string; requester: { full_name: string } | null; target: { full_name: string; email: string } | null };
type ApiToken = { id: string; name: string; scopes: string[]; last_used_at: string | null; expires_at: string | null; created_at: string };
type WebhookEp = { id: string; url: string; events: string[]; is_active: boolean; created_at: string };

const AVAILABLE_EVENTS = ['grade.posted', 'attendance.marked', 'fee.paid'];

function uid() { return crypto.randomUUID().replace(/-/g, '').slice(0, 32); }

export default function ComplianceClient({
  deletionRequests: initialDR,
  apiTokens: initialTokens,
}: {
  deletionRequests: DeletionReq[];
  apiTokens: ApiToken[];
}) {
  const supabase = createClient();
  const [requests, setRequests] = useState(initialDR);
  const [tokens, setTokens] = useState(initialTokens);
  const [webhooks, setWebhooks] = useState<WebhookEp[]>([]);
  const [webhooksLoaded, setWebhooksLoaded] = useState(false);
  const [whUrl, setWhUrl] = useState('');
  const [whEvents, setWhEvents] = useState<string[]>(AVAILABLE_EVENTS);
  const [creatingWh, setCreatingWh] = useState(false);
  const [newWhSecret, setNewWhSecret] = useState<string | null>(null);

  async function loadWebhooks() {
    if (webhooksLoaded) return;
    const data = await apiFetch<WebhookEp[]>('/payments/webhooks').catch(() => []);
    setWebhooks(data);
    setWebhooksLoaded(true);
  }

  async function createWebhook(e: React.FormEvent) {
    e.preventDefault();
    setCreatingWh(true);
    try {
      const result = await apiFetch<WebhookEp & { secret: string }>('/payments/webhooks', {
        method: 'POST',
        body: JSON.stringify({ url: whUrl.trim(), events: whEvents }),
      });
      setWebhooks((p) => [...p, result]);
      setNewWhSecret(result.secret);
      setWhUrl('');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed');
    } finally {
      setCreatingWh(false);
    }
  }

  async function deleteWebhook(id: string) {
    if (!confirm('Delete this webhook endpoint?')) return;
    await apiFetch(`/payments/webhooks/${id}`, { method: 'DELETE' });
    setWebhooks((p) => p.filter((w) => w.id !== id));
  }
  const [tokenName, setTokenName] = useState('');
  const [scopes, setScopes] = useState(['grades:read', 'attendance:read']);
  const [creating, setCreating] = useState(false);
  const [newToken, setNewToken] = useState<string | null>(null);

  async function handleApprove(id: string, approve: boolean) {
    const hardDeleteAfter = approve ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() : null;
    const { data: userRow } = await supabase.from('users').select('id').maybeSingle();
    await supabase.from('deletion_requests').update({
      status: approve ? 'APPROVED' : 'REJECTED',
      reviewed_by_id: userRow?.id,
      reviewed_at: new Date().toISOString(),
      hard_delete_after: hardDeleteAfter,
    }).eq('id', id);
    setRequests((p) => p.map((r) => r.id === id ? { ...r, status: approve ? 'APPROVED' : 'REJECTED' } : r));
  }

  async function createToken(e: React.FormEvent) {
    e.preventDefault(); setCreating(true); setNewToken(null);
    const raw = uid();
    const { data: userRow } = await supabase.from('users').select('id, school_id').maybeSingle();

    // Hash the token (SHA-256) — server-side only in a real system; we store hash here for display
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw))
      .then((buf) => Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join(''));

    const { data } = await supabase.from('api_tokens').insert({
      school_id: userRow?.school_id,
      created_by_id: userRow?.id,
      name: tokenName.trim(),
      token_hash: hash,
      scopes,
    }).select('id, name, scopes, last_used_at, expires_at, created_at').single();

    if (data) {
      setTokens((p) => [data as ApiToken, ...p]);
      setNewToken(`sm_${raw}`); // display once
      setTokenName('');
    }
    setCreating(false);
  }

  async function revokeToken(id: string) {
    if (!confirm('Revoke this token? Any integrations using it will stop working.')) return;
    await supabase.from('api_tokens').delete().eq('id', id);
    setTokens((p) => p.filter((t) => t.id !== id));
  }

  return (
    <div className="space-y-8">
      {/* Deletion requests */}
      <section className="space-y-3">
        <h2 className="text-base font-semibold text-slate-800">Data deletion requests</h2>
        {requests.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 bg-white p-8 text-center text-sm text-slate-400">No deletion requests.</div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            {requests.map((r, i) => (
              <div key={r.id} className={`px-5 py-4 flex items-start gap-4 ${i > 0 ? 'border-t border-slate-100' : ''}`}>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-slate-800">{r.target?.full_name ?? '—'} <span className="text-slate-400 font-normal text-sm">({r.target?.email})</span></p>
                  <p className="text-xs text-slate-400 mt-0.5">Requested by {r.requester?.full_name ?? '—'} · {new Date(r.created_at).toLocaleDateString()}</p>
                  {r.reason && <p className="text-sm text-slate-500 mt-1">{r.reason}</p>}
                </div>
                <div className="shrink-0 flex items-center gap-2">
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${r.status === 'PENDING' ? 'bg-amber-100 text-amber-700' : r.status === 'APPROVED' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                    {r.status}
                  </span>
                  {r.status === 'PENDING' && (
                    <>
                      <button onClick={() => handleApprove(r.id, true)} className="text-xs bg-emerald-600 text-white px-3 py-1 rounded-lg hover:bg-emerald-500">Approve</button>
                      <button onClick={() => handleApprove(r.id, false)} className="text-xs border border-slate-200 text-slate-600 px-3 py-1 rounded-lg hover:bg-slate-50">Reject</button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* API tokens */}
      <section className="space-y-3">
        <h2 className="text-base font-semibold text-slate-800">API tokens</h2>
        <p className="text-sm text-slate-500">Read-only tokens for third-party integrations (e.g. a BI tool or parent app).</p>

        <form onSubmit={createToken} className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Token name</label>
            <input value={tokenName} onChange={(e) => setTokenName(e.target.value)} required placeholder="e.g. BI Dashboard"
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm w-48" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Scopes</label>
            <div className="flex gap-2 flex-wrap">
              {['grades:read', 'attendance:read', 'students:read', 'fees:read'].map((s) => (
                <label key={s} className="flex items-center gap-1 text-xs cursor-pointer">
                  <input type="checkbox" checked={scopes.includes(s)}
                    onChange={(e) => setScopes((p) => e.target.checked ? [...p, s] : p.filter((x) => x !== s))} />
                  {s}
                </label>
              ))}
            </div>
          </div>
          <button type="submit" disabled={creating}
            className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-700 disabled:opacity-50">
            {creating ? 'Creating…' : 'Create token'}
          </button>
        </form>

        {newToken && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
            <p className="text-sm font-semibold text-amber-800 mb-1">Copy this token now — it won&apos;t be shown again:</p>
            <code className="block text-xs font-mono bg-white border border-amber-200 rounded px-3 py-2 break-all">{newToken}</code>
            <button onClick={() => setNewToken(null)} className="text-xs text-amber-500 mt-2 underline">Dismiss</button>
          </div>
        )}

        {tokens.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 bg-white p-8 text-center text-sm text-slate-400">No tokens yet.</div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            {tokens.map((t, i) => (
              <div key={t.id} className={`px-5 py-3 flex items-center gap-4 ${i > 0 ? 'border-t border-slate-100' : ''}`}>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-slate-800">{t.name}</p>
                  <p className="text-xs text-slate-400">{t.scopes.join(', ')} · Created {new Date(t.created_at).toLocaleDateString()}{t.last_used_at ? ` · Last used ${new Date(t.last_used_at).toLocaleDateString()}` : ' · Never used'}</p>
                </div>
                <button onClick={() => revokeToken(t.id)} className="text-xs text-rose-500 hover:text-rose-700 font-medium">Revoke</button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Webhooks */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-800">Webhooks</h2>
          {!webhooksLoaded && (
            <button onClick={loadWebhooks} className="text-xs text-slate-500 hover:text-slate-800 underline">Load endpoints</button>
          )}
        </div>
        <p className="text-sm text-slate-500">Receive real-time events when grades are posted, attendance is marked, or fees are paid.</p>

        <form onSubmit={createWebhook} className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-sm font-medium text-slate-700 mb-1">Endpoint URL</label>
            <input value={whUrl} onChange={(e) => setWhUrl(e.target.value)} required placeholder="https://your-server.com/webhook"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Events</label>
            <div className="flex gap-2">
              {AVAILABLE_EVENTS.map((ev) => (
                <label key={ev} className="flex items-center gap-1 text-xs cursor-pointer">
                  <input type="checkbox" checked={whEvents.includes(ev)}
                    onChange={(e) => setWhEvents((p) => e.target.checked ? [...p, ev] : p.filter((x) => x !== ev))} />
                  {ev}
                </label>
              ))}
            </div>
          </div>
          <button type="submit" disabled={creatingWh}
            className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-700 disabled:opacity-50">
            {creatingWh ? 'Adding…' : 'Add endpoint'}
          </button>
        </form>

        {newWhSecret && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
            <p className="text-sm font-semibold text-amber-800 mb-1">Copy your signing secret — shown once only:</p>
            <code className="block text-xs font-mono bg-white border border-amber-200 rounded px-3 py-2 break-all">{newWhSecret}</code>
            <p className="text-xs text-amber-600 mt-1">Verify webhooks by checking the <code>X-Webhook-Signature</code> header (HMAC-SHA256 of the body).</p>
            <button onClick={() => setNewWhSecret(null)} className="text-xs text-amber-500 mt-2 underline">Dismiss</button>
          </div>
        )}

        {webhooksLoaded && webhooks.length === 0 && (
          <div className="rounded-xl border border-dashed border-slate-200 bg-white p-8 text-center text-sm text-slate-400">No webhook endpoints configured.</div>
        )}

        {webhooks.length > 0 && (
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            {webhooks.map((w, i) => (
              <div key={w.id} className={`px-5 py-3 flex items-center gap-4 ${i > 0 ? 'border-t border-slate-100' : ''}`}>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-slate-800 truncate">{w.url}</p>
                  <p className="text-xs text-slate-400">{w.events.join(', ')}</p>
                </div>
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${w.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                  {w.is_active ? 'Active' : 'Inactive'}
                </span>
                <button onClick={() => deleteWebhook(w.id)} className="text-xs text-rose-500 hover:text-rose-700 font-medium">Delete</button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
