'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';

type Window = 'week' | 'month' | 'term' | 'all';
type Scope = 'school' | 'class' | 'grade';
type Row = { studentId: string; fullName: string; total: number; breakdown: Record<string, number> };
type Result = { rows: Row[]; capped: boolean; scope: Scope; window: Window };

const WINDOW_LABEL: Record<Window, string> = { week: 'This week', month: 'This month', term: 'This term', all: 'All-time' };
const MEDALS = ['🥇', '🥈', '🥉'];

function breakdownLabel(breakdown: Record<string, number>) {
  const parts = Object.entries(breakdown)
    .filter(([, v]) => v !== 0)
    .sort((a, b) => b[1] - a[1])
    .map(([cat, v]) => `${v > 0 ? '+' : ''}${v} ${cat}`);
  return parts.join(', ');
}

export default function LeaderboardClient({
  role,
  classTeacherOfId,
  teachableClasses,
  gradeLevels,
}: {
  role: string;
  classTeacherOfId: string | null;
  teachableClasses: { id: string; name: string }[];
  gradeLevels: number[];
}) {
  const canGradeScope = role === 'ADMIN';
  const canClassScope = role === 'ADMIN' || role === 'TEACHER';

  const [win, setWin] = useState<Window>('week');
  const [scope, setScope] = useState<Scope>('school');
  const [classId, setClassId] = useState('');
  const [gradeLevel, setGradeLevel] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Restore last-used selection (per browser/device, as specced).
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('leaderboard-prefs') ?? '{}');
      if (saved.window) setWin(saved.window);
      if (saved.scope) setScope(saved.scope);
    } catch { /* ignore malformed storage */ }
  }, []);

  useEffect(() => {
    localStorage.setItem('leaderboard-prefs', JSON.stringify({ window: win, scope }));
  }, [win, scope]);

  useEffect(() => {
    if (scope === 'class' && !classId) { setResult(null); return; }
    if (scope === 'grade' && !gradeLevel) { setResult(null); return; }
    setLoading(true);
    setError('');
    const params = new URLSearchParams({ window: win, scope });
    if (scope === 'class') params.set('classId', classId);
    if (scope === 'grade') params.set('gradeLevel', gradeLevel);
    apiFetch<Result>(`/behaviour/leaderboard?${params.toString()}`)
      .then(setResult)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load leaderboard'))
      .finally(() => setLoading(false));
  }, [win, scope, classId, gradeLevel]);

  return (
    <div className="max-w-2xl space-y-4">
      <div className="flex flex-wrap gap-2">
        {(Object.keys(WINDOW_LABEL) as Window[]).map((w) => (
          <button key={w} onClick={() => setWin(w)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${win === w ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
            {WINDOW_LABEL[w]}
          </button>
        ))}
      </div>

      {(canClassScope || canGradeScope) && (
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => setScope('school')}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${scope === 'school' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
            School-wide
          </button>
          {canClassScope && (
            <button onClick={() => setScope('class')}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${scope === 'class' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
              Per class
            </button>
          )}
          {canGradeScope && (
            <button onClick={() => setScope('grade')}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${scope === 'grade' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
              Per grade
            </button>
          )}

          {scope === 'class' && (
            <select value={classId} onChange={(e) => setClassId(e.target.value)}
              className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm">
              <option value="">Select a class…</option>
              {teachableClasses.map((c) => (
                <option key={c.id} value={c.id}>{c.name}{c.id === classTeacherOfId ? ' (your class)' : ''}</option>
              ))}
            </select>
          )}
          {scope === 'grade' && (
            <select value={gradeLevel} onChange={(e) => setGradeLevel(e.target.value)}
              className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm">
              <option value="">Select a grade…</option>
              {gradeLevels.map((g) => <option key={g} value={g}>Grade {g}</option>)}
            </select>
          )}
        </div>
      )}

      {result?.capped && (
        <p className="text-xs text-slate-400">Showing the top {result.rows.length}.</p>
      )}
      {!result?.capped && result && result.scope === 'class' && (
        <p className="text-xs text-slate-400">Full class ranking.</p>
      )}

      {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

      {loading ? (
        <p className="text-sm text-slate-400 py-6 text-center">Loading…</p>
      ) : !result || result.rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-white p-10 text-center text-sm text-slate-400">
          {scope !== 'school' && !classId && !gradeLevel
            ? 'Select a class or grade above.'
            : 'No behaviour points recorded yet for this view — be the first teacher to mark one!'}
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
          {result.rows.map((r, i) => (
            <div key={r.studentId} className={`flex items-center gap-3 px-4 py-3 ${i < 3 ? 'bg-amber-50/40' : ''}`}>
              <span className="w-8 text-center text-sm font-semibold text-slate-500 shrink-0">
                {i < 3 ? MEDALS[i] : `#${i + 1}`}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-800 truncate">{r.fullName}</p>
                {breakdownLabel(r.breakdown) && (
                  <p className="text-xs text-slate-400 truncate">{breakdownLabel(r.breakdown)}</p>
                )}
              </div>
              <span className="text-sm font-bold text-slate-700 shrink-0">{r.total} pts</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
