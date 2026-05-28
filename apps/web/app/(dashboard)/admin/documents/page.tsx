'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import BackButton from '@/components/BackButton';

type Doc = {
  id: string; title: string; file_url: string; file_name: string;
  file_size: number | null; mime_type: string | null; audience: string;
  target_grade_level: number | null; tags: string[]; created_at: string;
  uploader: { full_name: string } | null;
};

function fileSize(bytes: number | null) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileIcon(mime: string | null) {
  if (!mime) return '📄';
  if (mime.includes('pdf')) return '📕';
  if (mime.includes('word') || mime.includes('document')) return '📝';
  if (mime.includes('sheet') || mime.includes('excel')) return '📊';
  if (mime.startsWith('image')) return '🖼';
  return '📄';
}

export default function DocumentsPage() {
  const supabase = createClient();
  const [docs, setDocs] = useState<Doc[]>([]);
  const [classes, setClasses] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showUpload, setShowUpload] = useState(false);

  // Form state
  const [title, setTitle] = useState('');
  const [audience, setAudience] = useState('SCHOOL_WIDE');
  const [gradeLevel, setGradeLevel] = useState('');
  const [classId, setClassId] = useState('');
  const [tags, setTags] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    supabase.from('documents')
      .select('id, title, file_url, file_name, file_size, mime_type, audience, target_grade_level, tags, created_at, uploader:users!uploaded_by_id(full_name)')
      .order('created_at', { ascending: false })
      .then(({ data }) => { setDocs((data ?? []) as any[]); setLoading(false); });

    supabase.from('classes').select('id, name').eq('is_active', true).order('name')
      .then(({ data }) => setClasses(data ?? []));
  }, []);

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!file || !title.trim()) return;
    setUploading(true); setErr('');

    const { data: userRow } = await supabase.from('users').select('id, school_id').maybeSingle();
    const path = `documents/${userRow?.school_id}/${Date.now()}_${file.name}`;

    const { error: uploadErr } = await supabase.storage
      .from('documents').upload(path, file, { upsert: false, contentType: file.type });
    if (uploadErr) { setErr(uploadErr.message); setUploading(false); return; }

    const { data: { publicUrl } } = supabase.storage.from('documents').getPublicUrl(path);

    const { data, error } = await supabase.from('documents').insert({
      school_id: userRow?.school_id,
      uploaded_by_id: userRow?.id,
      title: title.trim(),
      file_url: publicUrl,
      file_name: file.name,
      file_size: file.size,
      mime_type: file.type,
      audience,
      target_grade_level: gradeLevel ? parseInt(gradeLevel) : null,
      target_class_id: classId || null,
      tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
    }).select('id, title, file_url, file_name, file_size, mime_type, audience, target_grade_level, tags, created_at, uploader:users!uploaded_by_id(full_name)').single();

    if (error) { setErr(error.message); } else {
      setDocs((p) => [data as any, ...p]);
      setShowUpload(false); setTitle(''); setAudience('SCHOOL_WIDE'); setTags(''); setFile(null); setGradeLevel(''); setClassId('');
    }
    setUploading(false);
  }

  async function deleteDoc(id: string) {
    if (!confirm('Delete this document?')) return;
    await supabase.from('documents').delete().eq('id', id);
    setDocs((p) => p.filter((d) => d.id !== id));
  }

  const filtered = docs.filter((d) =>
    d.title.toLowerCase().includes(search.toLowerCase()) ||
    d.tags.some((t) => t.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <BackButton href="/admin" />
        <div>
          <h1 className="text-2xl font-semibold">Document library</h1>
          <p className="text-sm text-slate-500 mt-0.5">Upload syllabi, past papers, school policies, and more.</p>
        </div>
      </div>

      <div className="flex gap-3 flex-wrap">
        <input value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by title or tag…"
          className="flex-1 min-w-[200px] rounded-lg border border-slate-200 px-3 py-2 text-sm" />
        <button onClick={() => setShowUpload((v) => !v)}
          className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-700">
          {showUpload ? 'Cancel' : '+ Upload document'}
        </button>
      </div>

      {showUpload && (
        <form onSubmit={handleUpload} className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          {err && <p className="text-sm text-red-600">{err}</p>}
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-1">Title</label>
              <input value={title} onChange={(e) => setTitle(e.target.value)} required
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Audience</label>
              <select value={audience} onChange={(e) => setAudience(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm">
                <option value="SCHOOL_WIDE">School-wide</option>
                <option value="GRADE">Specific grade</option>
                <option value="CLASS">Specific class</option>
              </select>
            </div>
            {audience === 'GRADE' && (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Grade level</label>
                <input type="number" min="1" value={gradeLevel} onChange={(e) => setGradeLevel(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
              </div>
            )}
            {audience === 'CLASS' && (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Class</label>
                <select value={classId} onChange={(e) => setClassId(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm">
                  <option value="">Select…</option>
                  {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            )}
            <div className="col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-1">Tags (comma-separated)</label>
              <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="syllabus, maths, term1"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-1">File</label>
              <input type="file" required onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.jpg,.png"
                className="text-sm text-slate-600" />
            </div>
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
          {search ? 'No documents match your search.' : 'No documents uploaded yet.'}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((d) => (
            <div key={d.id} className="flex items-center gap-4 bg-white border border-slate-100 rounded-xl px-5 py-3">
              <span className="text-2xl shrink-0">{fileIcon(d.mime_type)}</span>
              <div className="flex-1 min-w-0">
                <a href={d.file_url} target="_blank" rel="noopener noreferrer"
                  className="font-medium text-slate-800 hover:underline truncate block">{d.title}</a>
                <p className="text-xs text-slate-400 mt-0.5">
                  {d.file_name}{d.file_size ? ` · ${fileSize(d.file_size)}` : ''}
                  {d.audience !== 'SCHOOL_WIDE' ? ` · ${d.audience.toLowerCase()}` : ''}
                  {d.tags.length > 0 ? ` · ${d.tags.join(', ')}` : ''}
                </p>
              </div>
              <button onClick={() => deleteDoc(d.id)} className="text-slate-300 hover:text-rose-500 transition-colors text-lg leading-none shrink-0">×</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
