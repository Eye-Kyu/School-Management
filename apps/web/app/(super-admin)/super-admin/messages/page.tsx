'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';

type School = { id: string; name: string };
type Package = { id: string; name: string };
type SentMessage = {
  id: string; subject: string; body: string; sent_at: string;
  recipientCount: number; readCount: number;
};

type Audience =
  | { type: 'ALL' }
  | { type: 'PACKAGE'; packageId: string }
  | { type: 'MANUAL'; schoolIds: string[] };

export default function SuperAdminMessagesPage() {
  const [schools, setSchools] = useState<School[]>([]);
  const [packages, setPackages] = useState<Package[]>([]);
  const [sent, setSent] = useState<SentMessage[]>([]);
  const [loadingSent, setLoadingSent] = useState(true);

  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [audienceType, setAudienceType] = useState<'ALL' | 'PACKAGE' | 'MANUAL'>('ALL');
  const [packageId, setPackageId] = useState('');
  const [selectedSchoolIds, setSelectedSchoolIds] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  function loadSent() {
    setLoadingSent(true);
    apiFetch<SentMessage[]>('/super-admin/platform-messages')
      .then(setSent)
      .catch(() => {})
      .finally(() => setLoadingSent(false));
  }

  useEffect(() => {
    apiFetch<School[]>('/super-admin/schools').then(setSchools).catch(() => {});
    apiFetch<Package[]>('/super-admin/packages').then(setPackages).catch(() => {});
    loadSent();
  }, []);

  function toggleSchool(id: string) {
    setSelectedSchoolIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    setError(''); setSuccess('');

    let audience: Audience;
    if (audienceType === 'ALL') {
      audience = { type: 'ALL' };
    } else if (audienceType === 'PACKAGE') {
      if (!packageId) { setError('Select a package.'); return; }
      audience = { type: 'PACKAGE', packageId };
    } else {
      if (selectedSchoolIds.size === 0) { setError('Select at least one school.'); return; }
      audience = { type: 'MANUAL', schoolIds: Array.from(selectedSchoolIds) };
    }

    setSending(true);
    try {
      const result = await apiFetch<{ recipientCount: number }>('/super-admin/platform-messages', {
        method: 'POST',
        body: JSON.stringify({ subject, body, audience }),
      });
      setSuccess(`Sent to ${result.recipientCount} school admin${result.recipientCount !== 1 ? 's' : ''}.`);
      setSubject(''); setBody(''); setAudienceType('ALL'); setPackageId(''); setSelectedSchoolIds(new Set());
      loadSent();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send message');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-8 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold">Platform Messages</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Broadcast in-app announcements to School Admins. One-way — there is no reply thread; direct them to the support channel for responses.
        </p>
      </div>

      <form onSubmit={handleSend} className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
        {error && <p className="text-sm text-red-600">{error}</p>}
        {success && <p className="text-sm text-emerald-600">{success}</p>}

        <div>
          <label className="block text-sm font-medium text-slate-700">Subject</label>
          <input value={subject} onChange={(e) => setSubject(e.target.value)} required maxLength={200}
            className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700">Message</label>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} required rows={5} maxLength={5000}
            className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm resize-none" />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">Audience</label>
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" checked={audienceType === 'ALL'} onChange={() => setAudienceType('ALL')} />
              All schools ({schools.length})
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" checked={audienceType === 'PACKAGE'} onChange={() => setAudienceType('PACKAGE')} />
              Schools on a specific package
            </label>
            {audienceType === 'PACKAGE' && (
              <select value={packageId} onChange={(e) => setPackageId(e.target.value)}
                className="ml-6 rounded-md border border-slate-300 px-2 py-1.5 text-sm">
                <option value="">Select package…</option>
                {packages.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            )}
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" checked={audienceType === 'MANUAL'} onChange={() => setAudienceType('MANUAL')} />
              Manually select schools
            </label>
            {audienceType === 'MANUAL' && (
              <div className="ml-6 max-h-48 overflow-y-auto border border-slate-200 rounded-md p-2 space-y-1">
                {schools.map((s) => (
                  <label key={s.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={selectedSchoolIds.has(s.id)} onChange={() => toggleSchool(s.id)} />
                    {s.name}
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>

        <button type="submit" disabled={sending}
          className="bg-slate-900 text-white px-4 py-2 rounded-md text-sm font-medium disabled:opacity-50">
          {sending ? 'Sending…' : 'Send broadcast'}
        </button>
      </form>

      <div className="space-y-3">
        <h2 className="text-lg font-semibold">Sent messages</h2>
        {loadingSent ? (
          <p className="text-sm text-slate-400">Loading…</p>
        ) : sent.length === 0 ? (
          <p className="text-sm text-slate-400">No messages sent yet.</p>
        ) : (
          <div className="bg-white border border-slate-200 rounded-lg divide-y divide-slate-100">
            {sent.map((m) => (
              <div key={m.id} className="px-5 py-3">
                <div className="flex items-center justify-between">
                  <p className="font-medium text-sm">{m.subject}</p>
                  <span className="text-xs text-slate-500">
                    {m.readCount} of {m.recipientCount} read
                  </span>
                </div>
                <p className="text-sm text-slate-600 mt-1 line-clamp-2">{m.body}</p>
                <p className="text-xs text-slate-400 mt-1">{new Date(m.sent_at).toLocaleString()}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
