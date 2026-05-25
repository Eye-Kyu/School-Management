'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';

type ClassOption = { id: string; name: string; grade_level: number; stream: string | null };

export default function PromoteClient({
  classes,
  countByClass,
}: {
  classes: ClassOption[];
  countByClass: Record<string, number>;
}) {
  const router = useRouter();
  const [fromClassId, setFromClassId] = useState<string | null>(null);
  const [toClassId, setToClassId] = useState('');
  const [promoting, setPromoting] = useState(false);
  const [result, setResult] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const fromClass = classes.find((c) => c.id === fromClassId);
  const studentCount = fromClassId ? (countByClass[fromClassId] ?? 0) : 0;
  const destinationClasses = classes.filter((c) => c.id !== fromClassId);
  const toClass = classes.find((c) => c.id === toClassId);

  function selectClass(id: string) {
    setFromClassId(id);
    setToClassId('');
    setResult(null);
  }

  function reset() {
    setFromClassId(null);
    setToClassId('');
    setResult(null);
  }

  async function handlePromote() {
    if (!fromClassId) return;
    if (!confirm(
      toClassId
        ? `Move ${studentCount} student${studentCount !== 1 ? 's' : ''} from "${fromClass?.name}" to "${toClass?.name}"? This cannot be undone.`
        : `Deactivate ${studentCount} student${studentCount !== 1 ? 's' : ''} from "${fromClass?.name}"? They will no longer appear in the active students list.`
    )) return;

    setPromoting(true);
    setResult(null);
    try {
      const res = await apiFetch<{ promoted?: number; graduated?: number; action: string }>(
        '/students/promote',
        {
          method: 'POST',
          body: JSON.stringify({ fromClassId, toClassId: toClassId || undefined }),
        },
      );
      const count = res.promoted ?? res.graduated ?? 0;
      const message = res.action === 'promoted'
        ? `${count} student${count !== 1 ? 's' : ''} promoted to ${toClass?.name}.`
        : `${count} student${count !== 1 ? 's' : ''} graduated and deactivated.`;
      setResult({ message, type: 'success' });
      router.refresh();
      reset();
    } catch (err) {
      setResult({ message: err instanceof Error ? err.message : 'Promotion failed', type: 'error' });
    } finally {
      setPromoting(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Result banner */}
      {result && (
        <div className={`rounded-xl px-5 py-3 text-sm font-medium ${
          result.type === 'success'
            ? 'bg-emerald-50 border border-emerald-200 text-emerald-800'
            : 'bg-rose-50 border border-rose-200 text-rose-700'
        }`}>
          {result.message}
        </div>
      )}

      {/* Warning banner */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-3 text-sm text-amber-800">
        <strong>End-of-year action.</strong> This permanently moves or deactivates students.
        Run once per year before the new academic year begins.
      </div>

      {/* Step 1: Pick source class */}
      <div>
        <h2 className="text-base font-semibold text-slate-800 mb-3">
          {fromClassId ? (
            <span>
              Selected: <span className="text-violet-700">{fromClass?.name}</span>
              <button onClick={reset} className="ml-3 text-sm font-normal text-slate-400 hover:text-slate-700">
                ← Change
              </button>
            </span>
          ) : (
            'Step 1 — Select the class to promote from'
          )}
        </h2>

        {!fromClassId && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {classes.map((c) => {
              const count = countByClass[c.id] ?? 0;
              return (
                <button
                  key={c.id}
                  onClick={() => selectClass(c.id)}
                  className="bg-white border border-slate-200 rounded-xl px-4 py-4 text-left hover:border-violet-400 hover:shadow-sm transition-all group"
                >
                  <p className="font-semibold text-slate-800 text-sm group-hover:text-violet-700">{c.name}</p>
                  <p className="text-xs text-slate-400 mt-1">
                    {count} active student{count !== 1 ? 's' : ''}
                  </p>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Step 2: Pick action */}
      {fromClassId && (
        <div className="space-y-4">
          <h2 className="text-base font-semibold text-slate-800">
            Step 2 — Choose what to do with {studentCount} student{studentCount !== 1 ? 's' : ''}
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Option A: Promote to another class */}
            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
              <div>
                <p className="font-semibold text-slate-800 text-sm">Promote to another class</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  Moves all {studentCount} students to a different class.
                </p>
              </div>
              <select
                value={toClassId}
                onChange={(e) => setToClassId(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
              >
                <option value="">Select destination class…</option>
                {destinationClasses.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              {toClassId && (
                <p className="text-xs text-slate-500">
                  {studentCount} student{studentCount !== 1 ? 's' : ''} will move from{' '}
                  <strong>{fromClass?.name}</strong> → <strong>{toClass?.name}</strong>
                </p>
              )}
              <button
                onClick={handlePromote}
                disabled={!toClassId || promoting}
                className="w-full px-4 py-2 rounded-lg bg-violet-600 text-white text-sm font-medium hover:bg-violet-700 disabled:opacity-40 transition-colors"
              >
                {promoting && toClassId ? 'Promoting…' : 'Confirm promotion'}
              </button>
            </div>

            {/* Option B: Graduate / deactivate */}
            <div className="bg-white border border-rose-200 rounded-xl p-5 space-y-3">
              <div>
                <p className="font-semibold text-slate-800 text-sm">Graduate / deactivate</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  For final-year students leaving the school. Marks {studentCount} student
                  {studentCount !== 1 ? 's' : ''} as inactive.
                </p>
              </div>
              <div className="bg-rose-50 border border-rose-100 rounded-lg px-3 py-2 text-xs text-rose-700">
                Students will no longer appear in the active student list and cannot log in.
              </div>
              <button
                onClick={() => { setToClassId(''); handlePromote(); }}
                disabled={promoting}
                className="w-full px-4 py-2 rounded-lg bg-rose-600 text-white text-sm font-medium hover:bg-rose-700 disabled:opacity-40 transition-colors"
              >
                {promoting && !toClassId ? 'Graduating…' : 'Graduate these students'}
              </button>
            </div>
          </div>
        </div>
      )}

      {classes.length === 0 && (
        <div className="bg-white border border-slate-200 rounded-xl px-5 py-10 text-center text-sm text-slate-400">
          No active classes found.
        </div>
      )}
    </div>
  );
}
