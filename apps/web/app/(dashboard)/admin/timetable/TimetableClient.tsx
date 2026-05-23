'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { CreateTimetableSlotInput } from '@school-manager/types';
import { DAYS, DAY_LABELS, formatTime } from '@/lib/utils/days';

type Slot = {
  id: string; day_of_week: string; start_time: string; end_time: string; room: string | null;
  class: { id: string; name: string };
  subject: { id: string; name: string; code: string };
  teacher: { id: string; user: { full_name: string } };
};
type ClassOption = { id: string; name: string; grade_level: number };
type SubjectOption = { id: string; name: string; code: string };
type TeacherOption = { id: string; user: { full_name: string } };

export default function TimetableClient({
  initialSlots, classes, subjects, teachers,
}: {
  initialSlots: Slot[];
  classes: ClassOption[];
  subjects: SubjectOption[];
  teachers: TeacherOption[];
}) {
  const router = useRouter();
  const [slots, setSlots] = useState(initialSlots);
  const [filterClass, setFilterClass] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [classId, setClassId] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [teacherId, setTeacherId] = useState('');
  const [day, setDay] = useState('MONDAY');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [room, setRoom] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const displayed = filterClass ? slots.filter((s) => s.class.id === filterClass) : slots;
  const byDay = Object.fromEntries(
    DAYS.map((d) => [d, displayed.filter((s) => s.day_of_week === d)]),
  );

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const result = CreateTimetableSlotInput.safeParse({
      classId, subjectId, teacherId,
      dayOfWeek: day,
      startTime, endTime,
      room: room || undefined,
    });
    if (!result.success) { setError(result.error.issues[0]?.message ?? 'Invalid'); return; }

    setLoading(true);
    try {
      const created = await apiFetch<Slot>('/timetable', {
        method: 'POST',
        body: JSON.stringify(result.data),
      });
      setSlots((prev) => [...prev, created].sort((a, b) =>
        DAYS.indexOf(a.day_of_week as any) - DAYS.indexOf(b.day_of_week as any) ||
        a.start_time.localeCompare(b.start_time),
      ));
      setShowForm(false);
      setClassId(''); setSubjectId(''); setTeacherId('');
      setDay('MONDAY'); setStartTime(''); setEndTime(''); setRoom('');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally { setLoading(false); }
  }

  async function handleDelete(id: string) {
    if (!confirm('Remove this timetable slot?')) return;
    try {
      await apiFetch(`/timetable/${id}`, { method: 'DELETE' });
      setSlots((prev) => prev.filter((s) => s.id !== id));
      router.refresh();
    } catch (err) { alert(err instanceof Error ? err.message : 'Failed'); }
  }

  return (
    <div className="space-y-5">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={filterClass}
          onChange={(e) => setFilterClass(e.target.value)}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        >
          <option value="">All classes</option>
          {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="bg-slate-900 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-slate-700"
        >
          {showForm ? 'Cancel' : '+ Add slot'}
        </button>
      </div>

      {/* Add slot form */}
      {showForm && (
        <form onSubmit={handleCreate} className="bg-white border border-slate-200 rounded-lg p-5 space-y-4 max-w-lg">
          <h3 className="font-medium text-sm">New timetable slot</h3>
          {error && <p className="text-sm text-red-600 bg-red-50 rounded px-3 py-2">{error}</p>}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Class</label>
              <select value={classId} onChange={(e) => setClassId(e.target.value)} required
                className="block w-full rounded border border-slate-300 px-2 py-1.5 text-sm">
                <option value="">—</option>
                {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Subject</label>
              <select value={subjectId} onChange={(e) => setSubjectId(e.target.value)} required
                className="block w-full rounded border border-slate-300 px-2 py-1.5 text-sm">
                <option value="">—</option>
                {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Teacher</label>
              <select value={teacherId} onChange={(e) => setTeacherId(e.target.value)} required
                className="block w-full rounded border border-slate-300 px-2 py-1.5 text-sm">
                <option value="">—</option>
                {teachers.map((t) => <option key={t.id} value={t.id}>{t.user.full_name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Day</label>
              <select value={day} onChange={(e) => setDay(e.target.value)} required
                className="block w-full rounded border border-slate-300 px-2 py-1.5 text-sm">
                {DAYS.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Start time</label>
              <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} required
                className="block w-full rounded border border-slate-300 px-2 py-1.5 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">End time</label>
              <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} required
                className="block w-full rounded border border-slate-300 px-2 py-1.5 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Room (optional)</label>
              <input value={room} onChange={(e) => setRoom(e.target.value)} placeholder="Lab 1"
                className="block w-full rounded border border-slate-300 px-2 py-1.5 text-sm" />
            </div>
          </div>
          <button type="submit" disabled={loading}
            className="bg-slate-900 text-white px-4 py-2 rounded text-sm disabled:opacity-50">
            {loading ? 'Adding…' : 'Add slot'}
          </button>
        </form>
      )}

      {/* Weekly grid */}
      {DAYS.map((d) => (
        <div key={d}>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">
            {DAY_LABELS[d]}
          </h3>
          {byDay[d]?.length === 0 ? (
            <p className="text-sm text-slate-400 ml-2">—</p>
          ) : (
            <div className="space-y-1.5">
              {byDay[d]?.map((slot) => (
                <div key={slot.id}
                  className="flex items-center justify-between bg-white border border-slate-200
                             rounded-lg px-4 py-2.5 text-sm">
                  <div className="flex items-center gap-4">
                    <span className="text-slate-500 w-28 shrink-0">
                      {formatTime(slot.start_time)} – {formatTime(slot.end_time)}
                    </span>
                    <span className="font-medium">{slot.subject.name}</span>
                    <span className="text-slate-500">{slot.class.name}</span>
                    <span className="text-slate-400 text-xs">{slot.teacher.user.full_name}</span>
                    {slot.room && <span className="text-xs text-slate-400">{slot.room}</span>}
                  </div>
                  <button onClick={() => handleDelete(slot.id)}
                    className="text-xs text-slate-300 hover:text-red-500 transition-colors ml-4">
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
