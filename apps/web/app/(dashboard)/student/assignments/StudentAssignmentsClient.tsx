'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

type Assignment = {
  id: string; title: string; description: string | null; due_date: string;
  max_score: number | null; subject: { name: string } | null; term: { name: string } | null;
};
type Submission = {
  id: string; submitted_at: string; is_late: boolean;
  grade_score: number | null; grade_comment: string | null;
  file_urls: string[]; content: string | null;
};

export default function StudentAssignmentsClient({
  assignments, submissionMap: initialMap, studentId,
}: {
  assignments: Assignment[];
  submissionMap: Record<string, Submission>;
  studentId: string;
  schoolId: string;
}) {
  const supabase = createClient();
  const [subMap, setSubMap] = useState(initialMap);
  const [open, setOpen] = useState<string | null>(null);
  const [viewOpen, setViewOpen] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');
  const [err, setErr] = useState('');

  function dueStatus(due: string) {
    const diff = new Date(due).getTime() - Date.now();
    const days = Math.ceil(diff / 86400000);
    if (days < 0) return { label: 'Overdue', color: 'text-rose-600 bg-rose-50' };
    if (days === 0) return { label: 'Due today', color: 'text-amber-600 bg-amber-50' };
    if (days <= 3) return { label: `Due in ${days}d`, color: 'text-amber-500 bg-amber-50' };
    return { label: new Date(due).toLocaleDateString('en-KE', { day: 'numeric', month: 'short' }), color: 'text-slate-500 bg-slate-100' };
  }

  function isPastDeadline(dueDate: string) {
    return new Date() > new Date(dueDate);
  }

  async function handleSubmit(e: React.FormEvent, assignment: Assignment) {
    e.preventDefault();
    if (!studentId) return;
    if (isPastDeadline(assignment.due_date)) {
      setErr('Deadline passed. Ask your teacher for an extension.');
      return;
    }
    setSubmitting(true); setErr(''); setUploadProgress('');

    try {
      const { data: authData } = await supabase.auth.getUser();
      const { data: userRow } = await supabase.from('users').select('id, school_id').eq('auth_id', authData?.user?.id ?? '').maybeSingle();

      // Upload files to Supabase Storage
      const fileUrls: string[] = [];
      for (let i = 0; i < files.length; i++) {
        setUploadProgress(`Uploading file ${i + 1}/${files.length}…`);
        const file = files[i]!;
        const path = `submissions/${assignment.id}/${studentId}/${Date.now()}_${file.name}`;
        const { error: uploadErr } = await supabase.storage
          .from('assignments')
          .upload(path, file, { upsert: true, contentType: file.type });
        if (uploadErr) throw new Error(`File upload failed: ${uploadErr.message}`);
        const { data: { publicUrl } } = supabase.storage.from('assignments').getPublicUrl(path);
        fileUrls.push(publicUrl);
      }

      setUploadProgress('');

      // Upsert submission
      const { data, error } = await supabase.from('submissions').upsert({
        school_id: userRow?.school_id,
        assignment_id: assignment.id,
        student_id: studentId,
        content: content.trim() || null,
        file_urls: fileUrls,
        submitted_at: new Date().toISOString(),
        is_late: false,
      }, { onConflict: 'assignment_id,student_id' })
        .select('id, submitted_at, is_late, grade_score, grade_comment, file_urls, content')
        .single();

      if (error) throw new Error(error.message);
      setSubMap((p) => ({ ...p, [assignment.id]: data as any }));
      setOpen(null); setContent(''); setFiles([]);
    } catch (e: any) {
      setErr(e.message ?? 'Submission failed');
    } finally {
      setSubmitting(false); setUploadProgress('');
    }
  }

  if (assignments.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
        No assignments yet.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {assignments.map((a) => {
        const sub = subMap[a.id];
        const status = dueStatus(a.due_date);
        const isOpen = open === a.id;

        return (
          <div key={a.id} className={`bg-white border rounded-xl overflow-hidden ${sub ? 'border-emerald-200' : 'border-slate-200'}`}>
            <div className="px-5 py-4 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium text-slate-800">{a.title}</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  {(a.subject as any)?.name ?? ''}
                  {(a.term as any)?.name ? ` · ${(a.term as any).name}` : ''}
                </p>
                {a.description && (
                  <p className="text-sm text-slate-600 mt-2 whitespace-pre-wrap">{a.description}</p>
                )}
              </div>
              <div className="shrink-0 flex flex-col items-end gap-2">
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${status.color}`}>
                  {status.label}
                </span>
                {sub ? (
                  <div className="flex flex-col items-end gap-1">
                    <span className="text-xs font-medium text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
                      ✓ Submitted{sub.is_late ? ' (late)' : ''}
                      {sub.grade_score != null ? ` · ${sub.grade_score}${a.max_score ? `/${a.max_score}` : ''}` : ''}
                    </span>
                    <p className="text-xs text-slate-500">
                      Submitted on {new Date(sub.submitted_at).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </p>
                    <button onClick={() => setViewOpen(viewOpen === a.id ? null : a.id)}
                      className="text-xs font-medium text-slate-500 hover:text-slate-700 underline">
                      {viewOpen === a.id ? 'Hide submission' : 'View your submission →'}
                    </button>
                  </div>
                ) : isPastDeadline(a.due_date) ? (
                  <span className="text-xs font-medium text-rose-600 bg-rose-50 px-2 py-0.5 rounded-full">
                    Deadline passed
                  </span>
                ) : (
                  <button onClick={() => { setOpen(isOpen ? null : a.id); setErr(''); setContent(''); setFiles([]); }}
                    className="text-xs font-medium text-slate-600 border border-slate-300 px-3 py-1 rounded-lg hover:bg-slate-50">
                    {isOpen ? 'Cancel' : 'Submit'}
                  </button>
                )}
              </div>
            </div>

            {/* Grade feedback */}
            {sub?.grade_comment && (
              <div className="mx-5 mb-4 bg-emerald-50 border border-emerald-100 rounded-lg px-4 py-2.5 text-sm text-emerald-800">
                <span className="font-medium">Teacher feedback:</span> {sub.grade_comment}
              </div>
            )}

            {/* Read-only view of your own submission — cannot edit/resubmit */}
            {sub && viewOpen === a.id && (
              <div className="border-t border-slate-100 px-5 py-4 bg-slate-50 space-y-3">
                {sub.content && (
                  <div>
                    <p className="text-xs font-medium text-slate-500 mb-1">Your answer</p>
                    <p className="text-sm text-slate-700 whitespace-pre-wrap">{sub.content}</p>
                  </div>
                )}
                {sub.file_urls.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-slate-500 mb-1">Attached files</p>
                    <ul className="space-y-1">
                      {sub.file_urls.map((url, i) => (
                        <li key={i}>
                          <a href={url} target="_blank" rel="noopener noreferrer"
                            className="text-sm text-blue-600 hover:underline">
                            {url.split('/').pop()}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {!sub.content && sub.file_urls.length === 0 && (
                  <p className="text-sm text-slate-500">No content recorded for this submission.</p>
                )}
              </div>
            )}

            {/* Submission form */}
            {isOpen && !sub && (
              <form onSubmit={(e) => handleSubmit(e, a)}
                className="border-t border-slate-100 px-5 py-4 space-y-3 bg-slate-50">
                {err && <p role="alert" className="text-sm text-red-600">{err}</p>}
                {uploadProgress && <p className="text-sm text-slate-500">{uploadProgress}</p>}
                <div>
                  <label htmlFor={`assignment-answer-${a.id}`} className="block text-sm font-medium text-slate-700 mb-1">Your answer (text)</label>
                  <textarea id={`assignment-answer-${a.id}`} value={content} onChange={(e) => setContent(e.target.value)} rows={4}
                    maxLength={10000} placeholder="Type your answer here…" aria-label="Your answer"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm resize-none" />
                </div>
                <div>
                  <label htmlFor={`assignment-files-${a.id}`} className="block text-sm font-medium text-slate-700 mb-1">Attach files (optional)</label>
                  <input id={`assignment-files-${a.id}`} type="file" multiple accept=".pdf,.doc,.docx,.txt,.jpg,.jpeg,.png"
                    onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
                    aria-label="Attach files"
                    className="text-sm text-slate-600" />
                  {files.length > 0 && (
                    <p className="text-xs text-slate-500 mt-1">{files.length} file(s) selected</p>
                  )}
                </div>
                <div className="flex justify-end">
                  <button type="submit"
                    disabled={submitting || isPastDeadline(a.due_date) || (!content.trim() && files.length === 0)}
                    className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-700 disabled:opacity-50">
                    {submitting
                      ? 'Submitting…'
                      : isPastDeadline(a.due_date)
                        ? 'Deadline passed. Ask your teacher for an extension.'
                        : 'Submit assignment'}
                  </button>
                </div>
              </form>
            )}
          </div>
        );
      })}
    </div>
  );
}
