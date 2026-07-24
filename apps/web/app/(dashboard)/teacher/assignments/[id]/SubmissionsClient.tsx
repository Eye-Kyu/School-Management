'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { getCurrentUserRow } from '@/lib/supabase/currentUser';
import { apiFetch } from '@/lib/api';

type Student = { id: string; user: { full_name: string } };
type Submission = {
  id: string; student_id: string; content: string | null; file_urls: string[];
  submitted_at: string; is_late: boolean; grade_score: number | null; grade_comment: string | null;
};

export default function SubmissionsClient({
  assignmentId, maxScore, students, submissions: initialSubs,
}: {
  assignmentId: string;
  maxScore: number | null;
  students: Student[];
  submissions: Submission[];
}) {
  const supabase = createClient();
  const [submissions, setSubmissions] = useState<Record<string, Submission>>(
    Object.fromEntries(initialSubs.map((s) => [s.student_id, s])),
  );
  const [grading, setGrading] = useState<Record<string, { score: string; comment: string }>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [plagiarismResults, setPlagiarismResults] = useState<Record<string, { ai_probability: number; plagiarism_risk: string; recommendation: string; flags: string[] }>>({});
  const [checkingPlagiarism, setCheckingPlagiarism] = useState<Record<string, boolean>>({});
  const [resetOpen, setResetOpen] = useState<string | null>(null);
  const [resetReason, setResetReason] = useState<Record<string, string>>({});
  const [resetting, setResetting] = useState<Record<string, boolean>>({});
  const [resetError, setResetError] = useState<Record<string, string>>({});

  async function resetAttempt(studentId: string) {
    const reason = (resetReason[studentId] ?? '').trim();
    if (reason.length < 10) {
      setResetError((p) => ({ ...p, [studentId]: 'Reason must be at least 10 characters.' }));
      return;
    }
    setResetting((p) => ({ ...p, [studentId]: true }));
    setResetError((p) => ({ ...p, [studentId]: '' }));

    const userRow = await getCurrentUserRow('id, school_id');
    const { data: deleted, error } = await supabase.from('submissions').delete()
      .eq('assignment_id', assignmentId).eq('student_id', studentId).select('id');

    if (error) {
      setResetError((p) => ({ ...p, [studentId]: error.message }));
      setResetting((p) => ({ ...p, [studentId]: false }));
      return;
    }
    if (!deleted || deleted.length === 0) {
      setResetError((p) => ({ ...p, [studentId]: "You don't have permission to reset this submission." }));
      setResetting((p) => ({ ...p, [studentId]: false }));
      return;
    }

    await supabase.from('audit_logs').insert({
      id: crypto.randomUUID(),
      school_id: userRow?.school_id,
      user_id: userRow?.id,
      action: 'assignment.reset',
      entity_type: 'submission',
      entity_id: deleted[0]!.id,
      metadata: { student_id: studentId, reason, teacher_id: userRow?.id },
    });

    setSubmissions((p) => {
      const next = { ...p };
      delete next[studentId];
      return next;
    });
    setResetOpen(null);
    setResetReason((p) => ({ ...p, [studentId]: '' }));
    setResetting((p) => ({ ...p, [studentId]: false }));
  }

  async function checkPlagiarism(studentId: string, text: string | null) {
    if (!text?.trim()) return;
    setCheckingPlagiarism((p) => ({ ...p, [studentId]: true }));
    try {
      const result = await apiFetch<{ ai_probability: number; plagiarism_risk: string; recommendation: string; flags: string[] }>(
        '/ai/detect-plagiarism',
        { method: 'POST', body: JSON.stringify({ text }) },
      );
      setPlagiarismResults((p) => ({ ...p, [studentId]: result }));
    } catch { /* silent */ } finally {
      setCheckingPlagiarism((p) => ({ ...p, [studentId]: false }));
    }
  }

  const submitted = students.filter((s) => submissions[s.id]);
  const pending = students.filter((s) => !submissions[s.id]);

  function initGrade(studentId: string) {
    const sub = submissions[studentId];
    if (!grading[studentId]) {
      setGrading((p) => ({
        ...p,
        [studentId]: { score: String(sub?.grade_score ?? ''), comment: sub?.grade_comment ?? '' },
      }));
    }
  }

  async function saveGrade(studentId: string) {
    const g = grading[studentId];
    if (!g) return;
    setSaving((p) => ({ ...p, [studentId]: true }));
    const userRow = await getCurrentUserRow('id, school_id');
    const score = g.score === '' ? null : parseFloat(g.score);
    await supabase.from('submissions').update({
      grade_score: score,
      grade_comment: g.comment || null,
      graded_by_id: userRow?.id,
      graded_at: new Date().toISOString(),
    }).eq('assignment_id', assignmentId).eq('student_id', studentId);
    setSubmissions((p) => ({
      ...p,
      [studentId]: { ...p[studentId]!, grade_score: score, grade_comment: g.comment || null },
    }));
    setSaving((p) => ({ ...p, [studentId]: false }));
  }

  return (
    <div className="space-y-5">
      {/* Stats bar */}
      <div className="flex gap-4 flex-wrap">
        <div className="bg-white border border-slate-100 rounded-xl px-5 py-3 text-center">
          <p className="text-2xl font-bold text-slate-800">{submitted.length}</p>
          <p className="text-xs text-slate-400 mt-0.5">Submitted</p>
        </div>
        <div className="bg-white border border-slate-100 rounded-xl px-5 py-3 text-center">
          <p className="text-2xl font-bold text-slate-800">{pending.length}</p>
          <p className="text-xs text-slate-400 mt-0.5">Pending</p>
        </div>
        <div className="bg-white border border-slate-100 rounded-xl px-5 py-3 text-center">
          <p className="text-2xl font-bold text-amber-600">{submitted.filter((s) => submissions[s.id]?.is_late).length}</p>
          <p className="text-xs text-slate-400 mt-0.5">Late</p>
        </div>
        <div className="bg-white border border-slate-100 rounded-xl px-5 py-3 text-center">
          <p className="text-2xl font-bold text-emerald-600">{submitted.filter((s) => submissions[s.id]?.grade_score != null).length}</p>
          <p className="text-xs text-slate-400 mt-0.5">Graded</p>
        </div>
      </div>

      {/* Submissions list */}
      {submitted.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-white p-10 text-center text-sm text-slate-400">
          No submissions yet.
        </div>
      ) : (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-slate-600 uppercase tracking-wide">Submissions</h2>
          {submitted.map((s) => {
            const sub = submissions[s.id]!;
            const g = grading[s.id];
            return (
              <div key={s.id} className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-slate-800">{(s.user as any)?.full_name}</p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {new Date(sub.submitted_at).toLocaleString('en-KE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true })}
                      {sub.is_late && <span className="ml-2 text-amber-600 font-medium">Late</span>}
                    </p>
                  </div>
                  {sub.grade_score != null && (
                    <span className="text-sm font-semibold text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-full">
                      {sub.grade_score}{maxScore ? ` / ${maxScore}` : ''}
                    </span>
                  )}
                </div>

                {sub.content && (
                  <div className="space-y-2">
                    <div className="bg-slate-50 rounded-lg px-4 py-3 text-sm text-slate-700 whitespace-pre-wrap max-h-40 overflow-y-auto">
                      {sub.content}
                    </div>
                    {/* AI integrity check */}
                    {plagiarismResults[s.id] ? (
                      <div className={`flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg ${
                        plagiarismResults[s.id]!.recommendation === 'flag' ? 'bg-rose-50 text-rose-700 border border-rose-200'
                        : plagiarismResults[s.id]!.recommendation === 'review' ? 'bg-amber-50 text-amber-700 border border-amber-200'
                        : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                      }`}>
                        <span>{plagiarismResults[s.id]!.recommendation === 'flag' ? '🚩' : plagiarismResults[s.id]!.recommendation === 'review' ? '⚠️' : '✓'}</span>
                        <span className="font-medium">AI: {(plagiarismResults[s.id]!.ai_probability * 100).toFixed(0)}%</span>
                        <span>·</span>
                        <span>Plagiarism risk: {plagiarismResults[s.id]!.plagiarism_risk}</span>
                        {plagiarismResults[s.id]!.flags.length > 0 && (
                          <span className="ml-1 opacity-70">· {plagiarismResults[s.id]!.flags[0]}</span>
                        )}
                      </div>
                    ) : (
                      <button
                        onClick={() => checkPlagiarism(s.id, sub.content)}
                        disabled={checkingPlagiarism[s.id]}
                        className="text-xs text-slate-400 hover:text-violet-600 transition-colors disabled:opacity-50"
                      >
                        {checkingPlagiarism[s.id] ? '🔍 Checking…' : '🔍 Check with AI'}
                      </button>
                    )}
                  </div>
                )}

                {sub.file_urls.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {sub.file_urls.map((url, i) => (
                      <a key={i} href={url} target="_blank" rel="noopener noreferrer"
                        className="text-xs text-blue-600 underline">
                        File {i + 1}
                      </a>
                    ))}
                  </div>
                )}

                {/* Grade section */}
                <div className="border-t border-slate-100 pt-3 flex items-start justify-between gap-3 flex-wrap">
                  {g ? (
                    <div className="flex items-end gap-2 flex-wrap">
                      <div>
                        <label className="block text-xs text-slate-500 mb-1">Score{maxScore ? ` (max ${maxScore})` : ''}</label>
                        <input type="number" min={0} max={maxScore ?? undefined} step="0.5"
                          value={g.score} onChange={(e) => setGrading((p) => ({ ...p, [s.id]: { ...p[s.id]!, score: e.target.value } }))}
                          className="w-20 rounded-lg border border-slate-200 px-2 py-1.5 text-sm text-center" />
                      </div>
                      <div className="flex-1 min-w-[160px]">
                        <label className="block text-xs text-slate-500 mb-1">Comment</label>
                        <input value={g.comment} onChange={(e) => setGrading((p) => ({ ...p, [s.id]: { ...p[s.id]!, comment: e.target.value } }))}
                          placeholder="Optional feedback…"
                          className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm" />
                      </div>
                      <button onClick={() => saveGrade(s.id)} disabled={saving[s.id]}
                        className="px-3 py-1.5 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-700 disabled:opacity-50">
                        {saving[s.id] ? 'Saving…' : 'Save grade'}
                      </button>
                    </div>
                  ) : (
                    <button onClick={() => initGrade(s.id)}
                      className="text-sm text-slate-500 hover:text-slate-800 underline">
                      {sub.grade_score != null ? 'Edit grade' : 'Add grade'}
                    </button>
                  )}

                  <button onClick={() => setResetOpen(resetOpen === s.id ? null : s.id)}
                    className="text-xs text-rose-500 hover:text-rose-700 underline">
                    Reset attempt
                  </button>
                </div>

                {resetOpen === s.id && (
                  <div className="border-t border-slate-100 pt-3 space-y-2">
                    <p className="text-xs text-slate-500">
                      This permanently deletes {(s.user as any)?.full_name}'s submission so they can resubmit before the deadline. This cannot be undone.
                    </p>
                    <textarea rows={2} placeholder="Reason for reset (required, min 10 characters)…"
                      value={resetReason[s.id] ?? ''}
                      onChange={(e) => setResetReason((p) => ({ ...p, [s.id]: e.target.value }))}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm resize-none" />
                    {resetError[s.id] && <p className="text-xs text-rose-600">{resetError[s.id]}</p>}
                    <div className="flex justify-end gap-2">
                      <button onClick={() => setResetOpen(null)}
                        className="px-3 py-1.5 rounded-lg text-sm text-slate-500 hover:bg-slate-50">
                        Cancel
                      </button>
                      <button onClick={() => resetAttempt(s.id)} disabled={resetting[s.id]}
                        className="px-3 py-1.5 rounded-lg bg-rose-600 text-white text-sm font-medium hover:bg-rose-500 disabled:opacity-50">
                        {resetting[s.id] ? 'Resetting…' : 'Confirm reset'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Not submitted */}
      {pending.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-slate-600 uppercase tracking-wide">Not submitted ({pending.length})</h2>
          <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
            {pending.map((s) => (
              <div key={s.id} className="px-5 py-2.5 text-sm text-slate-500">
                {(s.user as any)?.full_name}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
