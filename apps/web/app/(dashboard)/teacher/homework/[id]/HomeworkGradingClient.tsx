'use client';

import { Fragment, useState } from 'react';
import { apiFetch } from '@/lib/api';

type Submission = {
  id: string;
  admissionNo: string;
  fullName: string;
  completedAt: string;
  score: number | null;
  graderNote: string | null;
};

export default function HomeworkGradingClient({
  homeworkId,
  maxScore,
  submissions: initialSubmissions,
}: {
  homeworkId: string;
  maxScore: number | null;
  submissions: Submission[];
}) {
  const [submissions, setSubmissions] = useState(initialSubmissions);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [scoreInput, setScoreInput] = useState('');
  const [noteInput, setNoteInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const gradedCount = submissions.filter((s) => s.score != null).length;

  function openGrade(s: Submission) {
    setExpandedId(s.id);
    setScoreInput(s.score != null ? String(s.score) : '');
    setNoteInput(s.graderNote ?? '');
    setError('');
  }

  function cancelGrade() {
    setExpandedId(null);
    setError('');
  }

  async function handleSave(submissionId: string) {
    const score = Number(scoreInput);
    if (scoreInput.trim() === '' || isNaN(score) || score <= 0) {
      setError('Score must be a positive number.');
      return;
    }
    if (maxScore != null && score > maxScore) {
      setError(`Score cannot exceed ${maxScore}.`);
      return;
    }

    setSaving(true);
    setError('');
    try {
      const updated = await apiFetch<{ score: number; grader_note: string | null }>(
        `/homework/${homeworkId}/submissions/${submissionId}/grade`,
        { method: 'PATCH', body: JSON.stringify({ score, graderNote: noteInput || undefined }) },
      );
      setSubmissions((prev) => prev.map((s) =>
        s.id === submissionId ? { ...s, score: updated.score, graderNote: updated.grader_note } : s,
      ));
      setExpandedId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  if (submissions.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl px-5 py-12 text-center text-sm text-slate-400">
        No submissions yet — students haven&apos;t marked this homework complete.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600">
        <span>{submissions.length} submission{submissions.length !== 1 ? 's' : ''} · {gradedCount} graded</span>
        {gradedCount === submissions.length && (
          <span className="text-emerald-600 font-medium">All caught up — every submission graded.</span>
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-slate-600 text-xs uppercase tracking-wide">Student</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600 text-xs uppercase tracking-wide">Completed</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600 text-xs uppercase tracking-wide">Score</th>
              <th className="text-right px-4 py-3 font-medium text-slate-600 text-xs uppercase tracking-wide">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {submissions.map((s) => (
              <Fragment key={s.id}>
                <tr className="hover:bg-slate-50">
                  <td className="px-4 py-2.5 font-medium text-slate-800">
                    {s.fullName} <span className="text-slate-400 font-mono text-xs">({s.admissionNo})</span>
                  </td>
                  <td className="px-4 py-2.5 text-slate-500 text-xs">
                    {new Date(s.completedAt).toLocaleDateString('en-KE', { day: 'numeric', month: 'short' })}
                  </td>
                  <td className="px-4 py-2.5">
                    {s.score != null ? (
                      <span className="font-medium">{s.score}{maxScore != null ? `/${maxScore}` : ''}</span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <button
                      onClick={() => (expandedId === s.id ? cancelGrade() : openGrade(s))}
                      className="text-xs text-violet-600 hover:text-violet-800 font-medium"
                    >
                      {s.score != null ? 'Edit grade' : 'Grade'}
                    </button>
                  </td>
                </tr>
                {expandedId === s.id && (
                  <tr>
                    <td colSpan={4} className="bg-slate-50 px-4 py-4">
                      <div className="flex flex-wrap items-end gap-3">
                        <div>
                          <label htmlFor={`hw-grade-score-${s.id}`} className="block text-xs font-medium text-slate-500 mb-1">
                            Score{maxScore != null ? ` (out of ${maxScore})` : ''}
                          </label>
                          <input
                            id={`hw-grade-score-${s.id}`}
                            type="number" min="0" max={maxScore ?? undefined} step="any"
                            value={scoreInput} onChange={(e) => setScoreInput(e.target.value)}
                            className="w-28 rounded-lg border border-slate-200 px-3 py-2 text-sm"
                          />
                        </div>
                        <div className="flex-1 min-w-[200px]">
                          <label htmlFor={`hw-grade-note-${s.id}`} className="block text-xs font-medium text-slate-500 mb-1">Note (optional)</label>
                          <textarea
                            id={`hw-grade-note-${s.id}`}
                            rows={2} maxLength={1000} value={noteInput}
                            onChange={(e) => setNoteInput(e.target.value)}
                            placeholder="Feedback for the student…"
                            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm resize-none"
                          />
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleSave(s.id)}
                            disabled={saving}
                            className="rounded-lg bg-violet-600 text-white px-4 py-2 text-sm font-medium hover:bg-violet-700 disabled:opacity-50"
                          >
                            {saving ? 'Saving…' : 'Save'}
                          </button>
                          <button
                            onClick={cancelGrade}
                            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                      {error && <p className="text-xs text-rose-600 mt-2" role="alert">{error}</p>}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
