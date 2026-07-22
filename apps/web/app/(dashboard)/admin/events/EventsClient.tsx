'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, API_BASE } from '@/lib/api';

type SchoolEvent = {
  id: string;
  title: string;
  description: string | null;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  event_type: string;
  audience: string;
  target_grade_level: number | null;
  target_class_id: string | null;
};

type ClassOption = { id: string; name: string; grade_level: number };

const EVENT_TYPES = ['GENERAL', 'EXAM', 'HOLIDAY', 'PTA', 'SPORTS'] as const;
const AUDIENCES = ['SCHOOL_WIDE', 'GRADE', 'CLASS'] as const;

const TYPE_LABELS: Record<string, string> = {
  GENERAL: 'General', EXAM: 'Exam', HOLIDAY: 'Holiday', PTA: 'PTA Meeting', SPORTS: 'Sports',
};
const TYPE_COLORS: Record<string, string> = {
  GENERAL: 'bg-slate-100 text-slate-700',
  EXAM: 'bg-red-100 text-red-700',
  HOLIDAY: 'bg-green-100 text-green-700',
  PTA: 'bg-blue-100 text-blue-700',
  SPORTS: 'bg-orange-100 text-orange-700',
};

function formatDate(iso: string, allDay: boolean) {
  const d = new Date(iso);
  if (allDay) return d.toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' });
  return d.toLocaleString('en-KE', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const EMPTY: SchoolEvent = {
  id: '', title: '', description: '', starts_at: '', ends_at: '',
  all_day: false, event_type: 'GENERAL', audience: 'SCHOOL_WIDE',
  target_grade_level: null, target_class_id: null,
};

export default function EventsClient({
  events: initial,
  classes,
}: {
  events: SchoolEvent[];
  classes: ClassOption[];
}) {
  const router = useRouter();
  const [events, setEvents] = useState(initial);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<SchoolEvent | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const uniqueGrades = [...new Set(classes.map((c) => c.grade_level))].sort((a, b) => a - b);

  function openCreate() {
    setEditing(null);
    setForm(EMPTY);
    setError('');
    setShowForm(true);
  }

  function openEdit(ev: SchoolEvent) {
    setEditing(ev);
    setForm({
      ...ev,
      starts_at: ev.starts_at.slice(0, 16),
      ends_at: ev.ends_at.slice(0, 16),
    });
    setError('');
    setShowForm(true);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const payload: Record<string, unknown> = {
        title: form.title,
        description: form.description || undefined,
        startsAt: new Date(form.starts_at).toISOString(),
        endsAt: new Date(form.ends_at).toISOString(),
        allDay: form.all_day,
        eventType: form.event_type,
        audience: form.audience,
      };
      if (form.audience === 'GRADE') payload.targetGradeLevel = form.target_grade_level;
      if (form.audience === 'CLASS') payload.targetClassId = form.target_class_id;

      if (editing) {
        const updated = await apiFetch<SchoolEvent>(`/events/${editing.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
        setEvents((prev) => prev.map((ev) => (ev.id === editing.id ? updated : ev)));
      } else {
        const created = await apiFetch<SchoolEvent>('/events', { method: 'POST', body: JSON.stringify(payload) });
        setEvents((prev) => [...prev, created].sort((a, b) => a.starts_at.localeCompare(b.starts_at)));
      }
      setShowForm(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this event?')) return;
    try {
      await apiFetch(`/events/${id}`, { method: 'DELETE' });
      setEvents((prev) => prev.filter((ev) => ev.id !== id));
      router.refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Delete failed');
    }
  }

  const upcoming = events.filter((ev) => new Date(ev.ends_at) >= new Date());
  const past = events.filter((ev) => new Date(ev.ends_at) < new Date());

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">{events.length} event{events.length !== 1 ? 's' : ''} total</p>
        <div className="flex gap-2">
          <a
            href={`${API_BASE}/events/ics`}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
          >
            Export .ics
          </a>
          <button
            onClick={openCreate}
            className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 transition-colors"
          >
            Add Event
          </button>
        </div>
      </div>

      {events.length === 0 && (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center text-slate-400 text-sm">
          No events yet. Add the first one.
        </div>
      )}

      {upcoming.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide">Upcoming</h2>
          <EventTable events={upcoming} onEdit={openEdit} onDelete={handleDelete} />
        </section>
      )}

      {past.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide">Past</h2>
          <EventTable events={past} onEdit={openEdit} onDelete={handleDelete} />
        </section>
      )}

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-xl bg-white shadow-xl p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-semibold">{editing ? 'Edit Event' : 'New Event'}</h2>
            {error && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">{error}</p>
            )}
            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700">Title</label>
                <input
                  required value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">Description (optional)</label>
                <textarea
                  value={form.description ?? ''} rows={2}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none resize-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700">Start</label>
                  <input
                    required type={form.all_day ? 'date' : 'datetime-local'} value={form.starts_at}
                    onChange={(e) => setForm((f) => ({ ...f, starts_at: e.target.value }))}
                    className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700">End</label>
                  <input
                    required type={form.all_day ? 'date' : 'datetime-local'} value={form.ends_at}
                    onChange={(e) => setForm((f) => ({ ...f, ends_at: e.target.value }))}
                    className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input
                  id="allDay" type="checkbox" checked={form.all_day}
                  onChange={(e) => setForm((f) => ({ ...f, all_day: e.target.checked, starts_at: '', ends_at: '' }))}
                  className="h-4 w-4 rounded border-slate-300"
                />
                <label htmlFor="allDay" className="text-sm text-slate-700">All-day event</label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700">Type</label>
                  <select
                    value={form.event_type}
                    onChange={(e) => setForm((f) => ({ ...f, event_type: e.target.value }))}
                    className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
                  >
                    {EVENT_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700">Audience</label>
                  <select
                    value={form.audience}
                    onChange={(e) => setForm((f) => ({ ...f, audience: e.target.value, target_grade_level: null, target_class_id: null }))}
                    className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
                  >
                    {AUDIENCES.map((a) => (
                      <option key={a} value={a}>{a === 'SCHOOL_WIDE' ? 'Everyone' : a === 'GRADE' ? 'Grade' : 'Class'}</option>
                    ))}
                  </select>
                </div>
              </div>
              {form.audience === 'GRADE' && (
                <div>
                  <label className="block text-sm font-medium text-slate-700">Grade level</label>
                  <select
                    required value={form.target_grade_level ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, target_grade_level: Number(e.target.value) }))}
                    className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
                  >
                    <option value="">Select grade</option>
                    {uniqueGrades.map((g) => <option key={g} value={g}>Grade {g}</option>)}
                  </select>
                </div>
              )}
              {form.audience === 'CLASS' && (
                <div>
                  <label className="block text-sm font-medium text-slate-700">Class</label>
                  <select
                    required value={form.target_class_id ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, target_class_id: e.target.value }))}
                    className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
                  >
                    <option value="">Select class</option>
                    {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setShowForm(false)}
                  className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors">
                  Cancel
                </button>
                <button type="submit" disabled={saving}
                  className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50 transition-colors">
                  {saving ? 'Saving…' : (editing ? 'Save changes' : 'Create event')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function EventTable({
  events,
  onEdit,
  onDelete,
}: {
  events: SchoolEvent[];
  onEdit: (ev: SchoolEvent) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50">
          <tr>
            <th className="px-4 py-3 text-left font-medium text-slate-500">Event</th>
            <th className="px-4 py-3 text-left font-medium text-slate-500">Type</th>
            <th className="px-4 py-3 text-left font-medium text-slate-500">Date</th>
            <th className="px-4 py-3 text-left font-medium text-slate-500">Audience</th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {events.map((ev) => (
            <tr key={ev.id} className="hover:bg-slate-50">
              <td className="px-4 py-3 font-medium text-slate-800">{ev.title}</td>
              <td className="px-4 py-3">
                <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${TYPE_COLORS[ev.event_type] ?? 'bg-slate-100 text-slate-600'}`}>
                  {TYPE_LABELS[ev.event_type] ?? ev.event_type}
                </span>
              </td>
              <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{formatDate(ev.starts_at, ev.all_day)}</td>
              <td className="px-4 py-3 text-slate-500">
                {ev.audience === 'SCHOOL_WIDE' ? 'Everyone' : ev.audience === 'GRADE' ? `Grade ${ev.target_grade_level}` : 'Class'}
              </td>
              <td className="px-4 py-3 text-right">
                <div className="flex justify-end gap-2">
                  <button onClick={() => onEdit(ev)} className="text-xs text-slate-500 hover:text-slate-900">Edit</button>
                  <button onClick={() => onDelete(ev.id)} className="text-xs text-red-500 hover:text-red-700">Delete</button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
