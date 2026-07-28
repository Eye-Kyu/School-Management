'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { CreateClassInput } from '@school-manager/types';

type ClassRow = { id: string; name: string; grade_level: number; stream: string | null };
type TeacherOption = { id: string; full_name: string; is_class_teacher_of: string | null };

export default function ClassesClient({
  initialClasses, teachers, unsignedReportCardTeacherIds,
}: {
  initialClasses: ClassRow[];
  teachers: TeacherOption[];
  unsignedReportCardTeacherIds: string[];
}) {
  const router = useRouter();
  const [classes, setClasses] = useState(initialClasses);
  const [classTeachers, setClassTeachers] = useState(teachers);
  const unsignedSet = new Set(unsignedReportCardTeacherIds);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [gradeLevel, setGradeLevel] = useState('');
  const [stream, setStream] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    const result = CreateClassInput.safeParse({
      name,
      gradeLevel: Number(gradeLevel),
      stream: stream || undefined,
    });
    if (!result.success) { setError(result.error.issues[0]?.message ?? 'Invalid input'); return; }

    setLoading(true);
    try {
      const created = await apiFetch<ClassRow>('/classes', {
        method: 'POST',
        body: JSON.stringify(result.data),
      });
      setClasses((prev) => [...prev, created].sort((a, b) => a.grade_level - b.grade_level || a.name.localeCompare(b.name)));
      setShowForm(false);
      setName(''); setGradeLevel(''); setStream('');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create class');
    } finally {
      setLoading(false);
    }
  }

  async function handleSetClassTeacher(classId: string, className: string, newTeacherId: string) {
    const outgoing = classTeachers.find((t) => t.is_class_teacher_of === classId);
    const incoming = newTeacherId ? classTeachers.find((t) => t.id === newTeacherId) : null;

    const warnings: string[] = [];
    if (incoming?.is_class_teacher_of && incoming.is_class_teacher_of !== classId) {
      const displacedFrom = classes.find((c) => c.id === incoming.is_class_teacher_of);
      warnings.push(`${incoming.full_name} is already Class Teacher of ${displacedFrom?.name ?? 'another class'} — they will be removed from it.`);
    }
    if (outgoing && outgoing.id !== newTeacherId && unsignedSet.has(outgoing.id)) {
      warnings.push(`${outgoing.full_name} has not yet signed off this term's report cards for ${className}.`);
    }
    if (warnings.length > 0) {
      if (!confirm(`${warnings.join('\n')}\n\nContinue anyway?`)) return;
    }

    const prevClassTeachers = classTeachers;
    setClassTeachers((prev) => prev.map((t) => {
      if (t.id === newTeacherId) return { ...t, is_class_teacher_of: classId };
      if (t.is_class_teacher_of === classId) return { ...t, is_class_teacher_of: null };
      return t;
    }));

    try {
      await apiFetch(`/classes/${classId}/class-teacher`, {
        method: 'PATCH',
        body: JSON.stringify({ teacherId: newTeacherId || null }),
      });
      router.refresh();
    } catch (err) {
      setClassTeachers(prevClassTeachers);
      alert(err instanceof Error ? err.message : 'Failed to set class teacher');
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Archive this class? Students will remain but the class will be hidden.')) return;
    try {
      await apiFetch(`/classes/${id}`, { method: 'DELETE' });
      setClasses((prev) => prev.filter((c) => c.id !== id));
      router.refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete');
    }
  }

  return (
    <div className="space-y-4">
      <button
        onClick={() => setShowForm((v) => !v)}
        className="bg-slate-900 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-slate-700"
      >
        {showForm ? 'Cancel' : '+ Add class'}
      </button>

      {showForm && (
        <form onSubmit={handleCreate} className="bg-white border border-slate-200 rounded-lg p-5 space-y-4 max-w-md">
          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
          <div>
            <label htmlFor="class-name" className="block text-sm font-medium text-slate-700">Name</label>
            <input id="class-name" value={name} onChange={(e) => setName(e.target.value)} required placeholder="Grade 5 Blue"
              aria-label="Name"
              className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="class-grade-level" className="block text-sm font-medium text-slate-700">Grade level</label>
              <input id="class-grade-level" type="number" min={0} max={20} value={gradeLevel} onChange={(e) => setGradeLevel(e.target.value)} required
                aria-label="Grade level"
                className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
            </div>
            <div>
              <label htmlFor="class-stream" className="block text-sm font-medium text-slate-700">Stream (optional)</label>
              <input id="class-stream" value={stream} onChange={(e) => setStream(e.target.value)} placeholder="Blue"
                aria-label="Stream (optional)"
                className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
            </div>
          </div>
          <button type="submit" disabled={loading}
            className="bg-slate-900 text-white px-4 py-2 rounded-md text-sm disabled:opacity-50">
            {loading ? 'Creating…' : 'Create class'}
          </button>
        </form>
      )}

      {classes.length === 0 ? (
        <p className="text-sm text-slate-500">No classes yet. Add your first class above.</p>
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg divide-y divide-slate-100">
          {classes.map((c) => {
            const currentClassTeacher = classTeachers.find((t) => t.is_class_teacher_of === c.id);
            return (
              <div key={c.id} className="flex items-center justify-between gap-4 px-5 py-3">
                <div className="min-w-0">
                  <p className="font-medium text-sm">{c.name}</p>
                  <p className="text-xs text-slate-500">Grade {c.grade_level}{c.stream ? ` · ${c.stream}` : ''}</p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <div>
                    <label htmlFor={`class-teacher-${c.id}`} className="block text-[11px] text-slate-500 mb-0.5">Class Teacher</label>
                    <select
                      id={`class-teacher-${c.id}`}
                      value={currentClassTeacher?.id ?? ''}
                      onChange={(e) => handleSetClassTeacher(c.id, c.name, e.target.value)}
                      className="rounded-md border border-slate-300 px-2 py-1 text-xs min-w-[160px]"
                    >
                      <option value="">None assigned</option>
                      {teachers.map((t) => (
                        <option key={t.id} value={t.id}>{t.full_name}</option>
                      ))}
                    </select>
                  </div>
                  <button onClick={() => handleDelete(c.id)}
                    className="text-xs text-slate-500 hover:text-red-600 transition-colors">
                    Archive
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
