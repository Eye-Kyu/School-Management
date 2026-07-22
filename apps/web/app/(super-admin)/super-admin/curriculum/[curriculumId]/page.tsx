'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import BackButton from '@/components/BackButton';
import { apiFetch } from '@/lib/api';

type Subject = { id: string; grade_level: number; name: string; code: string | null };

type CurriculumDetail = {
  id: string;
  name: string;
  description: string;
  is_active: boolean;
  subjects: Subject[];
};

export default function CurriculumDetailPage() {
  const params = useParams<{ curriculumId: string }>();
  const curriculumId = params.curriculumId;

  const [curriculum, setCurriculum] = useState<CurriculumDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);

  const [subjects, setSubjects] = useState<{ gradeLevel: number; name: string; code: string }[]>([]);
  const [newGrade, setNewGrade] = useState('1');
  const [newName, setNewName] = useState('');
  const [savingSubjects, setSavingSubjects] = useState(false);

  function load() {
    setLoading(true);
    apiFetch<CurriculumDetail>(`/super-admin/curricula/${curriculumId}`)
      .then((c) => {
        setCurriculum(c);
        setName(c.name); setDescription(c.description); setIsActive(c.is_active);
        setSubjects(c.subjects.map((s) => ({ gradeLevel: s.grade_level, name: s.name, code: s.code ?? '' })));
      })
      .catch((e) => setErr(e instanceof Error ? e.message : 'Failed to load curriculum'))
      .finally(() => setLoading(false));
  }

  useEffect(load, [curriculumId]);

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErr('');
    try {
      await apiFetch(`/super-admin/curricula/${curriculumId}`, {
        method: 'PATCH',
        body: JSON.stringify({ name, description, isActive }),
      });
      setEditing(false);
      load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to update curriculum');
    } finally {
      setSaving(false);
    }
  }

  function addSubject() {
    if (!newName.trim()) return;
    setSubjects((prev) => [...prev, { gradeLevel: Number(newGrade), name: newName.trim(), code: '' }]);
    setNewName('');
  }

  function removeSubject(index: number) {
    setSubjects((prev) => prev.filter((_, i) => i !== index));
  }

  async function saveSubjects() {
    setSavingSubjects(true);
    setErr('');
    try {
      await apiFetch(`/super-admin/curricula/${curriculumId}/subjects`, {
        method: 'PUT',
        body: JSON.stringify({ subjects: subjects.map((s) => ({ gradeLevel: s.gradeLevel, name: s.name, code: s.code || undefined })) }),
      });
      load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to update subjects');
    } finally {
      setSavingSubjects(false);
    }
  }

  const byGrade = subjects.reduce<Record<number, typeof subjects>>((acc, s) => {
    (acc[s.gradeLevel] ??= []).push(s);
    return acc;
  }, {});

  if (loading || !curriculum) {
    return (
      <div className="space-y-6">
        <BackButton href="/super-admin/curriculum" />
        <p className="text-sm text-slate-400 text-center py-10">Loading…</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <BackButton href="/super-admin/curriculum" />
      {err && <p className="text-sm text-rose-600 bg-rose-50 rounded-lg px-3 py-2">{err}</p>}

      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold">{curriculum.name}</h1>
            {!curriculum.is_active && (
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">Inactive</span>
            )}
          </div>
          <button
            onClick={() => setEditing((v) => !v)}
            className="px-3 py-1.5 rounded-lg text-xs font-medium border border-slate-200 hover:bg-slate-50 transition-colors shrink-0"
          >
            {editing ? 'Cancel' : 'Edit'}
          </button>
        </div>

        {editing ? (
          <form onSubmit={saveProfile} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} required
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Description</label>
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
              Active (assignable to schools)
            </label>
            <button type="submit" disabled={saving}
              className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-700 disabled:opacity-50">
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </form>
        ) : (
          <p className="text-sm text-slate-600">{curriculum.description || '—'}</p>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-semibold">Subjects by grade</h2>
          <button
            onClick={saveSubjects}
            disabled={savingSubjects}
            className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-700 disabled:opacity-50"
          >
            {savingSubjects ? 'Saving…' : 'Save subjects'}
          </button>
        </div>
        <p className="text-sm text-slate-500 mb-4">Reference only — does not affect any school's actual subjects, classes, or timetable.</p>

        <div className="bg-white border border-slate-200 rounded-xl p-4 flex items-end gap-3 mb-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Grade</label>
            <input type="number" min={0} max={20} value={newGrade} onChange={(e) => setNewGrade(e.target.value)}
              className="w-20 border border-slate-200 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div className="flex-1">
            <label className="block text-xs font-medium text-slate-600 mb-1">Subject name</label>
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Mathematics"
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addSubject(); } }}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
          </div>
          <button onClick={addSubject} className="px-4 py-2 rounded-lg text-sm font-medium border border-slate-200 hover:bg-slate-50">
            Add
          </button>
        </div>

        {Object.keys(byGrade).length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 bg-white p-8 text-center text-sm text-slate-400">
            No subjects yet.
          </div>
        ) : (
          Object.entries(byGrade)
            .sort(([a], [b]) => Number(a) - Number(b))
            .map(([grade, subs]) => (
              <div key={grade} className="mb-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-1">Grade {grade}</p>
                <div className="bg-white border border-slate-100 rounded-xl divide-y divide-slate-100">
                  {subs.map((s) => {
                    const idx = subjects.indexOf(s);
                    return (
                      <div key={idx} className="flex items-center justify-between px-4 py-2 text-sm">
                        <span className="text-slate-700">{s.name}</span>
                        <button onClick={() => removeSubject(idx)} className="text-xs text-slate-300 hover:text-rose-500 transition-colors">
                          ✕
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
        )}
      </div>
    </div>
  );
}
