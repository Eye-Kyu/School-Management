'use client';

import { useState, useEffect, useCallback } from 'react';
import { apiFetch, apiUpload, ApiError } from '@/lib/api';
import DownloadButton from './DownloadButton';
import { fileSize, fileIcon, type DocumentRow } from './documentUtils';

type ListResponse = { rows: DocumentRow[]; total: number };
type Subtype = 'HOMEWORK' | 'QUIZ' | 'ONLINE_ASSIGNMENT';

// Shared "Attached documents" section for homework/quiz/assignment detail
// pages (Task 7) — teachers who created the assignment get an "Attach
// document" upload form defaulted to this exact assignment; everyone else
// gets a read-only list with download buttons.
export default function AttachedDocumentsSection({
  scopeSubtype, scopeId, canManage,
}: {
  scopeSubtype: Subtype;
  scopeId: string;
  canManage: boolean;
}) {
  const [docs, setDocs] = useState<DocumentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showUpload, setShowUpload] = useState(false);
  const [title, setTitle] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<ListResponse>(
        `/documents?scopeType=ASSIGNMENT&scopeSubtype=${scopeSubtype}&scopeId=${scopeId}&pageSize=50`,
      );
      setDocs(res.rows);
    } catch {
      setDocs([]);
    } finally {
      setLoading(false);
    }
  }, [scopeSubtype, scopeId]);

  useEffect(() => { load(); }, [load]);

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!file || !title.trim()) return;
    setUploading(true); setErr('');
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('title', title.trim());
      formData.append('scopeType', 'ASSIGNMENT');
      formData.append('scopeSubtype', scopeSubtype);
      formData.append('scopeId', scopeId);

      const created = await apiUpload<DocumentRow>('/documents', formData);
      setDocs((p) => [created, ...p]);
      setShowUpload(false); setTitle(''); setFile(null);

      apiFetch('/ai/process-document', { method: 'POST', body: JSON.stringify({ documentId: created.id }) }).catch(() => {});
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
        <h2 className="font-semibold text-slate-800 text-sm">Attached documents</h2>
        {canManage && (
          <button onClick={() => setShowUpload((v) => !v)} className="text-xs font-medium text-violet-700 hover:underline">
            {showUpload ? 'Cancel' : '+ Attach document'}
          </button>
        )}
      </div>

      {showUpload && canManage && (
        <form onSubmit={handleUpload} className="px-5 py-4 border-b border-slate-100 space-y-3">
          {err && <p className="text-sm text-rose-600">{err}</p>}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Title</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} required
              className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">File</label>
            <input type="file" required onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.jpg,.png"
              className="text-sm text-slate-600" />
          </div>
          <div className="flex justify-end">
            <button type="submit" disabled={uploading}
              className="px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-medium disabled:opacity-50">
              {uploading ? 'Uploading…' : 'Attach'}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <p className="text-sm text-slate-400 text-center py-6">Loading…</p>
      ) : docs.length === 0 ? (
        <p className="text-sm text-slate-400 text-center py-6">No attached documents.</p>
      ) : (
        <div className="divide-y divide-slate-100">
          {docs.map((d) => (
            <div key={d.id} className="flex items-center gap-3 px-5 py-2.5">
              <span className="text-lg shrink-0">{fileIcon(d.mime_type)}</span>
              <div className="flex-1 min-w-0">
                <DownloadButton documentId={d.id} title={d.title} className="text-sm font-medium text-slate-800 hover:underline truncate block text-left">
                  {d.title}
                </DownloadButton>
                <p className="text-xs text-slate-400">{d.file_name}{d.file_size ? ` · ${fileSize(d.file_size)}` : ''}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
