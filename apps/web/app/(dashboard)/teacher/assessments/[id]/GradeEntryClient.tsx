'use client';

import { useState } from 'react';
import { apiFetch } from '@/lib/api';

type RosterStudent = {
  id: string;
  admissionNo: string;
  fullName: string;
  marksObtained: number | null;
  comments: string;
};

export default function GradeEntryClient({
  assessmentId,
  maxMarks,
  roster: initialRoster,
  sourceType = 'DIRECT',
  sourceLabel = null,
}: {
  assessmentId: string;
  maxMarks: number;
  roster: RosterStudent[];
  sourceType?: 'DIRECT' | 'HOMEWORK' | 'QUIZ';
  sourceLabel?: string | null;
}) {
  const isLinked = sourceType !== 'DIRECT';
  const [marks, setMarks] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      initialRoster.map((s) => [s.id, s.marksObtained != null ? String(s.marksObtained) : '']),
    ),
  );
  const [comments, setComments] = useState<Record<string, string>>(() =>
    Object.fromEntries(initialRoster.map((s) => [s.id, s.comments])),
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  const filled = Object.values(marks).filter((v) => v !== '').length;
  const validMarks = Object.entries(marks)
    .filter(([, v]) => v !== '')
    .map(([, v]) => Number(v));
  const avg = validMarks.length > 0
    ? (validMarks.reduce((a, b) => a + b, 0) / validMarks.length).toFixed(1)
    : null;

  async function handleSave() {
    if (isLinked) return;
    setSaving(true);
    setSaved(false);
    setError('');
    try {
      const scores = initialRoster.map((s) => ({
        studentId: s.id,
        marksObtained: marks[s.id] !== '' ? Number(marks[s.id]) : null,
        comments: comments[s.id] || undefined,
      }));
      await apiFetch(`/assessments/${assessmentId}/scores`, {
        method: 'POST',
        body: JSON.stringify({ scores }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  if (initialRoster.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl px-5 py-12 text-center text-sm text-slate-400">
        No active students in this class.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {isLinked && (
        <div className="rounded-lg border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-800">
          🔒 This assessment is derived from a {sourceType === 'HOMEWORK' ? 'homework assignment' : 'quiz'}
          {sourceLabel ? `: "${sourceLabel}"` : ''}. Marks are read-only here — update them from the source instead.
        </div>
      )}

      {/* Summary bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-4 text-sm text-slate-600">
          <span>{initialRoster.length} students</span>
          <span>{filled} marked</span>
          {avg && <span>Class avg: <strong>{avg}</strong> / {maxMarks} ({Math.round((Number(avg) / maxMarks) * 100)}%)</span>}
        </div>
        {!isLinked && (
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-5 py-2 rounded-lg bg-violet-600 text-white text-sm font-medium hover:bg-violet-700 disabled:opacity-50 transition-colors"
          >
            {saving ? 'Saving…' : 'Save marks'}
          </button>
        )}
      </div>

      {error && <p className="text-sm text-rose-600">{error}</p>}
      {saved && <p className="text-sm text-emerald-600">Marks saved successfully.</p>}

      {/* Grade table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-slate-600 text-xs uppercase tracking-wide">Adm No</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600 text-xs uppercase tracking-wide">Student</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600 text-xs uppercase tracking-wide w-32">
                Marks / {maxMarks}
              </th>
              <th className="text-left px-4 py-3 font-medium text-slate-600 text-xs uppercase tracking-wide w-16">%</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600 text-xs uppercase tracking-wide">Comments</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {initialRoster.map((s) => {
              const val = marks[s.id];
              const num = val !== '' ? Number(val) : null;
              const pct = num != null && !isNaN(num) ? Math.round((num / maxMarks) * 100) : null;
              const pctColor =
                pct == null ? '' : pct >= 75 ? 'text-emerald-600' : pct >= 50 ? 'text-amber-600' : 'text-rose-600';

              return (
                <tr key={s.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2.5 text-slate-500 font-mono text-xs">{s.admissionNo}</td>
                  <td className="px-4 py-2.5 font-medium text-slate-800">{s.fullName}</td>
                  <td className="px-4 py-2.5">
                    {isLinked ? (
                      <span
                        title={`Derived from a ${sourceType === 'HOMEWORK' ? 'homework' : 'quiz'} — read-only. Update the source instead.`}
                        className="inline-block w-24 border border-dashed border-slate-300 bg-slate-50 rounded-md px-2 py-1 text-sm text-slate-500"
                      >
                        {val !== '' ? val : '—'}
                      </span>
                    ) : (
                      <input
                        type="number"
                        min={0}
                        max={maxMarks}
                        step="any"
                        value={val}
                        onChange={(e) => setMarks((prev) => ({ ...prev, [s.id]: e.target.value }))}
                        placeholder="—"
                        className="w-24 border border-slate-200 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
                      />
                    )}
                  </td>
                  <td className={`px-4 py-2.5 font-medium text-sm ${pctColor}`}>
                    {pct != null ? `${pct}%` : '—'}
                  </td>
                  <td className="px-4 py-2.5">
                    {isLinked ? (
                      <span className="inline-block w-full text-sm text-slate-500">
                        {comments[s.id] || '—'}
                      </span>
                    ) : (
                      <input
                        type="text"
                        value={comments[s.id]}
                        onChange={(e) => setComments((prev) => ({ ...prev, [s.id]: e.target.value }))}
                        placeholder="Optional…"
                        maxLength={300}
                        className="w-full border border-slate-200 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
                      />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Bottom save bar */}
      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-5 py-2 rounded-lg bg-violet-600 text-white text-sm font-medium hover:bg-violet-700 disabled:opacity-50 transition-colors"
        >
          {saving ? 'Saving…' : 'Save marks'}
        </button>
      </div>
    </div>
  );
}
