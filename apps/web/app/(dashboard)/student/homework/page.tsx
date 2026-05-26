'use client';

import { useState, useEffect } from 'react';
import { apiFetch } from '@/lib/api';

type Assignment = {
  id: string;
  title: string;
  description: string | null;
  due_date: string;
  class: { name: string } | null;
  subject: { name: string } | null;
  completedAt: string | null;
};

function isOverdue(dueDate: string, completedAt: string | null) {
  if (completedAt) return false;
  return new Date(dueDate) < new Date(new Date().toDateString());
}

export default function StudentHomeworkPage() {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<Assignment[]>('/homework')
      .then(setAssignments)
      .finally(() => setLoading(false));
  }, []);

  async function handleToggle(hw: Assignment) {
    setToggling(hw.id);
    try {
      if (hw.completedAt) {
        await apiFetch(`/homework/${hw.id}/complete`, { method: 'DELETE' });
        setAssignments((prev) => prev.map((a) => a.id === hw.id ? { ...a, completedAt: null } : a));
      } else {
        const res = await apiFetch<{ completed: boolean }>(`/homework/${hw.id}/complete`, { method: 'POST' });
        if (res.completed) {
          setAssignments((prev) => prev.map((a) => a.id === hw.id ? { ...a, completedAt: new Date().toISOString() } : a));
        }
      }
    } catch {
      // ignore toggle errors silently
    } finally {
      setToggling(null);
    }
  }

  const pending = assignments.filter((a) => !a.completedAt);
  const done = assignments.filter((a) => a.completedAt);

  if (loading) {
    return <div className="text-sm text-slate-400 p-6">Loading homework…</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Homework</h1>
        <p className="text-sm text-slate-500 mt-0.5">Tick off assignments when you&apos;ve completed them on paper.</p>
      </div>

      {assignments.length === 0 && (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center text-slate-400 text-sm">
          No homework assigned right now.
        </div>
      )}

      {pending.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide">To do ({pending.length})</h2>
          <div className="space-y-2">
            {pending.map((hw) => (
              <label
                key={hw.id}
                className={`flex items-start gap-3 rounded-lg border bg-white px-4 py-3 cursor-pointer transition-colors hover:bg-slate-50 ${
                  isOverdue(hw.due_date, hw.completedAt) ? 'border-red-200' : 'border-slate-200'
                }`}
              >
                <input
                  type="checkbox"
                  checked={false}
                  disabled={toggling === hw.id}
                  onChange={() => handleToggle(hw)}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 accent-slate-900"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-slate-800 text-sm">{hw.title}</span>
                    {hw.subject && (
                      <span className="text-xs bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">{hw.subject.name}</span>
                    )}
                  </div>
                  {hw.description && <p className="text-xs text-slate-500 mt-0.5">{hw.description}</p>}
                  <p className={`text-xs mt-0.5 ${isOverdue(hw.due_date, hw.completedAt) ? 'text-red-500 font-medium' : 'text-slate-400'}`}>
                    Due {new Date(hw.due_date).toLocaleDateString('en-KE', { weekday: 'short', day: 'numeric', month: 'short' })}
                    {isOverdue(hw.due_date, hw.completedAt) && ' — overdue'}
                  </p>
                </div>
              </label>
            ))}
          </div>
        </section>
      )}

      {done.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide">Done ({done.length})</h2>
          <div className="space-y-2">
            {done.map((hw) => (
              <label
                key={hw.id}
                className="flex items-start gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 opacity-60 cursor-pointer hover:opacity-80 transition-opacity"
              >
                <input
                  type="checkbox"
                  checked={true}
                  disabled={toggling === hw.id}
                  onChange={() => handleToggle(hw)}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 accent-slate-900"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-slate-600 text-sm line-through">{hw.title}</span>
                    <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded font-medium">Done</span>
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Due {new Date(hw.due_date).toLocaleDateString('en-KE', { day: 'numeric', month: 'short' })}
                  </p>
                </div>
              </label>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
