'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { apiFetch, apiUpload, ApiError } from '@/lib/api';
import BackButton from '@/components/BackButton';
import ScopePicker, { ScopeValue } from '@/components/documents/ScopePicker';
import DownloadButton from '@/components/documents/DownloadButton';
import RetagModal from '@/components/documents/RetagModal';
import { fileSize, fileIcon, scopeLabel, type DocumentRow } from '@/components/documents/documentUtils';

type ListResponse = { rows: DocumentRow[]; total: number; page: number; pageSize: number };
type DownloadCount = { document_id: string; download_count: number; unique_user_count: number };

const SCOPE_FILTERS = ['ALL', 'SCHOOL_WIDE', 'CLASS', 'SUBJECT', 'ASSIGNMENT'] as const;

function DocumentsPageInner() {
  const supabase = createClient();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [docs, setDocs] = useState<DocumentRow[]>([]);
  const [total, setTotal] = useState(0);
  const [classes, setClasses] = useState<{ id: string; name: string }[]>([]);
  const [subjects, setSubjects] = useState<{ id: string; name: string }[]>([]);
  const [uploaders, setUploaders] = useState<{ id: string; name: string }[]>([]);
  const [downloadCounts, setDownloadCounts] = useState<Record<string, DownloadCount>>({});
  const [loading, setLoading] = useState(true);
  const [showUpload, setShowUpload] = useState(false);
  const [retagging, setRetagging] = useState<DocumentRow | null>(null);

  // Filter state lives in URL query params — shareable/bookmarkable.
  const scopeFilter = (searchParams.get('scope') as (typeof SCOPE_FILTERS)[number]) ?? 'ALL';
  const uploaderFilter = searchParams.get('uploader') ?? '';
  const dateFrom = searchParams.get('from') ?? '';
  const dateTo = searchParams.get('to') ?? '';
  const q = searchParams.get('q') ?? '';

  function setParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value); else params.delete(key);
    router.push(`?${params.toString()}`);
  }

  // Form state
  const [title, setTitle] = useState('');
  const [scope, setScope] = useState<ScopeValue>({ scopeType: 'SCHOOL_WIDE' });
  const [tags, setTags] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (scopeFilter !== 'ALL') params.set('scopeType', scopeFilter);
    if (uploaderFilter) params.set('uploaderId', uploaderFilter);
    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo) params.set('dateTo', dateTo);
    if (q) params.set('q', q);
    params.set('pageSize', '100');

    try {
      const res = await apiFetch<ListResponse>(`/documents?${params.toString()}`);
      setDocs(res.rows);
      setTotal(res.total);

      if (res.rows.length > 0) {
        const ids = res.rows.map((d) => d.id).join(',');
        const counts = await apiFetch<DownloadCount[]>(`/documents/download-counts?ids=${ids}`);
        setDownloadCounts(Object.fromEntries(counts.map((c) => [c.document_id, c])));
      } else {
        setDownloadCounts({});
      }
    } catch {
      setDocs([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [scopeFilter, uploaderFilter, dateFrom, dateTo, q]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    supabase.from('classes').select('id, name').eq('is_active', true).order('name')
      .then(({ data }) => setClasses(data ?? []));
    supabase.from('subjects').select('id, name').order('name')
      .then(({ data }) => setSubjects(data ?? []));
    supabase.from('users').select('id, full_name').in('role', ['ADMIN', 'TEACHER']).order('full_name')
      .then(({ data }) => setUploaders((data ?? []).map((u) => ({ id: u.id, name: u.full_name }))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!file || !title.trim()) return;
    if (scope.scopeType !== 'SCHOOL_WIDE' && !scope.scopeId) { setErr('Select a target for this scope'); return; }
    setUploading(true); setErr('');

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('title', title.trim());
      formData.append('tags', tags);
      formData.append('scopeType', scope.scopeType);
      if (scope.scopeSubtype) formData.append('scopeSubtype', scope.scopeSubtype);
      if (scope.scopeId) formData.append('scopeId', scope.scopeId);

      const created = await apiUpload<DocumentRow>('/documents', formData);
      setDocs((p) => [created, ...p]);
      setTotal((t) => t + 1);
      setShowUpload(false); setTitle(''); setTags(''); setFile(null); setScope({ scopeType: 'SCHOOL_WIDE' });

      // Extract + chunk the document text in the background so the AI tutor
      // can retrieve real content instead of just the title.
      apiFetch('/ai/process-document', {
        method: 'POST',
        body: JSON.stringify({ documentId: created.id }),
      }).catch(() => {});
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  async function deleteDoc(id: string) {
    if (!confirm('Delete this document?')) return;
    try {
      await apiFetch(`/documents/${id}`, { method: 'DELETE' });
      setDocs((p) => p.filter((d) => d.id !== id));
      setTotal((t) => t - 1);
    } catch (e) {
      alert(e instanceof ApiError ? e.message : 'Delete failed');
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <BackButton href="/admin" />
        <div>
          <h1 className="text-2xl font-semibold">Document library</h1>
          <p className="text-sm text-slate-500 mt-0.5">Upload syllabi, past papers, school policies, and more.</p>
        </div>
      </div>

      {/* Filters */}
      <div className="space-y-3">
        <div className="flex gap-3 flex-wrap items-center">
          <input
            value={q}
            onChange={(e) => setParam('q', e.target.value)}
            placeholder="Search by title…"
            className="flex-1 min-w-[200px] rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />
          <input type="date" value={dateFrom} onChange={(e) => setParam('from', e.target.value)}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm" title="From date" />
          <input type="date" value={dateTo} onChange={(e) => setParam('to', e.target.value)}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm" title="To date" />
          <select value={uploaderFilter} onChange={(e) => setParam('uploader', e.target.value)}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
            <option value="">All uploaders</option>
            {uploaders.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <button onClick={() => setShowUpload((v) => !v)}
            className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-700">
            {showUpload ? 'Cancel' : '+ Upload document'}
          </button>
        </div>
        <div className="flex gap-2 flex-wrap">
          {SCOPE_FILTERS.map((s) => (
            <button key={s} onClick={() => setParam('scope', s === 'ALL' ? '' : s)}
              className={`text-sm rounded-full px-3 py-1 font-medium transition-colors ${
                scopeFilter === s ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}>
              {s === 'ALL' ? 'All' : s === 'SCHOOL_WIDE' ? 'School-wide' : s.charAt(0) + s.slice(1).toLowerCase()}
            </button>
          ))}
        </div>
      </div>

      {!loading && docs.length > 0 && Object.values(downloadCounts).some((c) => c.download_count > 0) && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100">
            <h2 className="font-semibold text-slate-800 text-sm">Most-downloaded documents</h2>
          </div>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-slate-100">
              {docs
                .map((d) => ({ doc: d, count: downloadCounts[d.id]?.download_count ?? 0 }))
                .filter((r) => r.count > 0)
                .sort((a, b) => b.count - a.count)
                .slice(0, 10)
                .map(({ doc, count }) => (
                  <tr key={doc.id}>
                    <td className="px-5 py-2 text-slate-700 truncate">{doc.title}</td>
                    <td className="px-5 py-2 text-slate-400 text-xs">{doc.uploader?.full_name ?? ''}</td>
                    <td className="px-5 py-2 text-right font-medium text-slate-800">{count}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}

      {showUpload && (
        <form onSubmit={handleUpload} className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          {err && <p className="text-sm text-red-600">{err}</p>}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Title</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} required
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
          </div>

          <ScopePicker value={scope} onChange={setScope} classes={classes} subjects={subjects} isAdmin />

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Tags (comma-separated)</label>
            <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="syllabus, maths, term1"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">File</label>
            <input type="file" required onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.jpg,.png"
              className="text-sm text-slate-600" />
          </div>

          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowUpload(false)}
              className="px-4 py-2 rounded-lg text-sm text-slate-600 hover:bg-slate-100">Cancel</button>
            <button type="submit" disabled={uploading}
              className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium disabled:opacity-50">
              {uploading ? 'Uploading…' : 'Upload'}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <p className="text-sm text-slate-400 text-center py-10">Loading…</p>
      ) : docs.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-white p-10 text-center text-sm text-slate-400">
          No documents match these filters.
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-slate-400">{total} document{total === 1 ? '' : 's'}</p>
          {docs.map((d) => {
            const dl = downloadCounts[d.id];
            return (
              <div key={d.id} className="flex items-center gap-4 bg-white border border-slate-100 rounded-xl px-5 py-3">
                <span className="text-2xl shrink-0">{fileIcon(d.mime_type)}</span>
                <div className="flex-1 min-w-0">
                  <DownloadButton documentId={d.id} title={d.title} className="font-medium text-slate-800 hover:underline truncate block text-left">
                    {d.title}
                  </DownloadButton>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {d.file_name}{d.file_size ? ` · ${fileSize(d.file_size)}` : ''}
                    {` · ${scopeLabel(d)}`}
                    {d.uploader ? ` · ${d.uploader.full_name}` : ''}
                    {d.tags.length > 0 ? ` · ${d.tags.join(', ')}` : ''}
                    {dl ? ` · ${dl.download_count} download${dl.download_count === 1 ? '' : 's'}` : ''}
                  </p>
                </div>
                <button onClick={() => setRetagging(d)} className="text-xs font-medium text-slate-500 hover:text-slate-800 shrink-0">
                  Change scope
                </button>
                <button onClick={() => deleteDoc(d.id)} className="text-slate-300 hover:text-rose-500 transition-colors text-lg leading-none shrink-0">×</button>
              </div>
            );
          })}
        </div>
      )}

      {retagging && (
        <RetagModal
          doc={retagging}
          classes={classes}
          subjects={subjects}
          isAdmin
          onClose={() => setRetagging(null)}
          onSaved={(updated) => setDocs((p) => p.map((d) => (d.id === updated.id ? updated : d)))}
        />
      )}
    </div>
  );
}

export default function DocumentsPage() {
  return (
    <Suspense fallback={<p className="text-sm text-slate-400 text-center py-10">Loading…</p>}>
      <DocumentsPageInner />
    </Suspense>
  );
}
