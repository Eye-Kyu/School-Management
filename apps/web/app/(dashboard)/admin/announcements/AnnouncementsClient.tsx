'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';

type Announcement = {
  id: string;
  title: string;
  body: string;
  audience: string;
  target_grade_level: number | null;
  target_class_id: string | null;
  published_at: string;
  author: { full_name: string };
};

type ClassOption = { id: string; name: string; grade_level: number };

const AUDIENCE_LABELS: Record<string, string> = {
  SCHOOL_WIDE: 'Everyone',
  TEACHERS: 'Teachers',
  PARENTS: 'Parents',
  GRADE: 'Grade',
  CLASS: 'Class',
};

export default function AnnouncementsClient({
  announcements: initial,
  classes,
}: {
  announcements: Announcement[];
  classes: ClassOption[];
}) {
  const router = useRouter();
  const [announcements, setAnnouncements] = useState(initial);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [audience, setAudience] = useState<'SCHOOL_WIDE' | 'TEACHERS' | 'PARENTS' | 'GRADE' | 'CLASS'>('SCHOOL_WIDE');
  const [gradeLevel, setGradeLevel] = useState('');
  const [classId, setClassId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');

    try {
      const payload: Record<string, unknown> = { title, body, audience };
      if (audience === 'GRADE') payload.targetGradeLevel = Number(gradeLevel);
      if (audience === 'CLASS') payload.targetClassId = classId;

      const created = await apiFetch<Announcement>('/announcements', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      setAnnouncements((prev) => [created, ...prev]);
      setShowForm(false);
      setTitle(''); setBody(''); setAudience('SCHOOL_WIDE'); setGradeLevel(''); setClassId('');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to post announcement');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this announcement?')) return;
    try {
      await apiFetch(`/announcements/${id}`, { method: 'DELETE' });
      setAnnouncements((prev) => prev.filter((a) => a.id !== id));
      router.refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Delete failed');
    }
  }

  const uniqueGrades = [...new Set(classes.map((c) => c.grade_level))].sort((a, b) => a - b);

  return (
    <div className="space-y-5">
      <button
        onClick={() => { setShowForm((v) => !v); setError(''); }}
        className="bg-slate-900 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-slate-700"
      >
        {showForm ? 'Cancel' : '+ New announcement'}
      </button>

      {showForm && (
        <form onSubmit={handleCreate} className="bg-white border border-slate-200 rounded-lg p-5 space-y-4 max-w-lg">
          {error && <p className="text-sm text-red-600 bg-red-50 rounded px-3 py-2">{error}</p>}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Title</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              maxLength={200}
              className="block w-full rounded border border-slate-300 px-3 py-2 text-sm"
              placeholder="End of term exams begin next Monday"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Body</label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              required
              rows={5}
              className="block w-full rounded border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Audience</label>
            <select
              value={audience}
              onChange={(e) => setAudience(e.target.value as any)}
              className="block w-full rounded border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="SCHOOL_WIDE">Everyone — teachers &amp; parents (school-wide)</option>
              <option value="TEACHERS">All teachers only</option>
              <option value="PARENTS">All parents only</option>
              <option value="GRADE">Parents &amp; teachers of a specific grade</option>
              <option value="CLASS">Parents &amp; teacher of a specific class</option>
            </select>
          </div>
          {audience === 'GRADE' && (
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Grade level</label>
              <select
                value={gradeLevel}
                onChange={(e) => setGradeLevel(e.target.value)}
                required
                className="block w-full rounded border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="">— select grade —</option>
                {uniqueGrades.map((g) => (
                  <option key={g} value={g}>Grade {g}</option>
                ))}
              </select>
            </div>
          )}
          {audience === 'CLASS' && (
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Class</label>
              <select
                value={classId}
                onChange={(e) => setClassId(e.target.value)}
                required
                className="block w-full rounded border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="">— select class —</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          )}
          <button
            type="submit"
            disabled={saving}
            className="bg-slate-900 text-white px-4 py-2 rounded text-sm disabled:opacity-50"
          >
            {saving ? 'Posting…' : 'Post announcement'}
          </button>
        </form>
      )}

      {announcements.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-lg px-5 py-10 text-center text-sm text-slate-400">
          No announcements yet.
        </div>
      ) : (
        <div className="space-y-3">
          {announcements.map((a) => (
            <div key={a.id} className="bg-white border border-slate-200 rounded-lg p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs bg-slate-100 text-slate-600 rounded px-2 py-0.5 font-medium">
                      {AUDIENCE_LABELS[a.audience]}
                      {a.audience === 'GRADE' && a.target_grade_level != null ? ` ${a.target_grade_level}` : ''}
                    </span>
                    <span className="text-xs text-slate-400">
                      {new Date(a.published_at).toLocaleDateString()}
                    </span>
                  </div>
                  <p className="font-medium">{a.title}</p>
                  <p className="text-sm text-slate-600 mt-1 whitespace-pre-wrap">{a.body}</p>
                  <p className="text-xs text-slate-400 mt-2">Posted by {a.author?.full_name}</p>
                </div>
                <button
                  onClick={() => handleDelete(a.id)}
                  className="text-xs text-slate-300 hover:text-red-500 transition-colors shrink-0 mt-0.5"
                >
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
