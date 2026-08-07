'use client';

import { useState, useEffect, useCallback } from 'react';
import { apiFetch, apiUpload, ApiError } from '@/lib/api';
import ScopePicker, { ScopeValue } from '@/components/documents/ScopePicker';
import DownloadButton from '@/components/documents/DownloadButton';
import { fileSize, fileIcon, type DocumentRow } from '@/components/documents/documentUtils';

type ListResponse = { rows: DocumentRow[]; total: number; page: number; pageSize: number };

// Teacher/student/parent's "school-wide documents" view — Task 6. Shows
// only SCHOOL_WIDE documents; CLASS/SUBJECT scope surfaces are deferred to
// the follow-up PR that ships alongside role-facing subject/class detail
// pages (schema + RLS already support them, per the Phase 2 plan — only
// this view's own filtering doesn't surface them yet).
export default function DocumentsClient({
  role, classes, subjects,
}: {
  role: string;
  classes: { id: string; name: string }[];
  subjects: { id: string; name: string }[];
}) {
  const canUpload = role === 'TEACHER' || role === 'ADMIN';

  const [docs, setDocs] = useState<DocumentRow[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [showUpload, setShowUpload] = useState(false);

  const [title, setTitle] = useState('');
  const [scope, setScope] = useState<ScopeValue>({ scopeType: 'SCHOOL_WIDE' });
  const [tags, setTags] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<ListResponse>('/documents?scopeType=SCHOOL_WIDE&pageSize=100');
      setDocs(res.rows);
    } catch {
      setDocs([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

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
      if (created.scope_type === 'SCHOOL_WIDE') setDocs((p) => [created, ...p]);
      setShowUpload(false); setTitle(''); setTags(''); setFile(null); setScope({ scopeType: 'SCHOOL_WIDE' });

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

  const filtered = docs.filter((d) =>
    d.title.toLowerCase().includes(search.toLowerCase()) ||
    d.tags.some((t) => t.toLowerCase().includes(search.toLowerCase())),
  );

  return (
    <div className="space-y-4">
      <div className="flex gap-3 flex-wrap">
        <input value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by title or tag…"
          className="flex-1 min-w-[200px] rounded-lg border border-slate-200 px-3 py-2 text-sm" />
        {canUpload && (
          <button onClick={() => setShowUpload((v) => !v)}
            className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-700">
            {showUpload ? 'Cancel' : '+ Upload document'}
          </button>
        )}
      </div>

      {showUpload && canUpload && (
        <form onSubmit={handleUpload} className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          {err && <p className="text-sm text-red-600">{err}</p>}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Title</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} required
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
          </div>

          <ScopePicker value={scope} onChange={setScope} classes={classes} subjects={subjects} isAdmin={role === 'ADMIN'} />

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
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-white p-10 text-center text-sm text-slate-400">
          {search ? 'No documents match your search.' : 'No school-wide documents yet.'}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((d) => (
            <div key={d.id} className="flex items-center gap-4 bg-white border border-slate-100 rounded-xl px-5 py-3">
              <span className="text-2xl shrink-0">{fileIcon(d.mime_type)}</span>
              <div className="flex-1 min-w-0">
                <DownloadButton documentId={d.id} title={d.title} className="font-medium text-slate-800 hover:underline truncate block text-left">
                  {d.title}
                </DownloadButton>
                <p className="text-xs text-slate-400 mt-0.5">
                  {d.file_name}{d.file_size ? ` · ${fileSize(d.file_size)}` : ''}
                  {d.uploader ? ` · ${d.uploader.full_name}` : ''}
                  {d.tags.length > 0 ? ` · ${d.tags.join(', ')}` : ''}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
