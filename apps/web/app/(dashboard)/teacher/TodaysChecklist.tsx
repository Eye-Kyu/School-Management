'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { schoolLocalDateParts } from '@/lib/utils/schoolTime';
import { formatTime } from '@/lib/utils/days';
import { useModuleAccess } from '@/lib/hooks/useModuleAccess';

type ChecklistData = {
  slots: { id: string; startTime: string; endTime: string; room: string | null; className: string; subjectName: string }[];
  attendanceItems: { classId: string; className: string; done: boolean }[];
  assignmentItems: { id: string; title: string; className: string; done: boolean }[];
  gradeItems: { id: string; name: string; className: string; done: boolean }[];
};

async function fetchChecklistData(teacherId: string, dateIso: string, dayEnum: string): Promise<ChecklistData> {
  const supabase = createClient();

  const [{ data: slots }, { data: assignmentClasses }] = await Promise.all([
    supabase
      .from('timetable_slots')
      .select('id, start_time, end_time, room, class_id, class:classes(name), subject:subjects(name)')
      .eq('teacher_id', teacherId)
      .eq('day_of_week', dayEnum)
      .order('start_time'),
    supabase.from('subject_assignments').select('class_id').eq('teacher_id', teacherId),
  ]);

  const classIds = Array.from(new Set([
    ...(slots ?? []).map((s: any) => s.class_id as string),
    ...(assignmentClasses ?? []).map((a: any) => a.class_id as string),
  ].filter(Boolean)));

  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

  const [{ data: attendanceRows }, { data: assignmentsDue }, { data: recentAssessments }, { data: rosterRows }] = classIds.length
    ? await Promise.all([
        supabase.from('attendance_records').select('class_id').eq('date', dateIso).in('class_id', classIds),
        supabase.from('assignments').select('id, title, class_id, class:classes(name)').eq('due_date', dateIso).in('class_id', classIds),
        supabase.from('assessments').select('id, name, class_id, created_at, class:classes(name)').in('class_id', classIds).gte('created_at', fourteenDaysAgo),
        supabase.from('students').select('id, current_class_id').in('current_class_id', classIds).eq('is_active', true),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }, { data: [] }];

  const rosterSizeByClass = new Map<string, number>();
  for (const s of rosterRows ?? []) {
    const cid = (s as any).current_class_id as string;
    rosterSizeByClass.set(cid, (rosterSizeByClass.get(cid) ?? 0) + 1);
  }

  const markedClassIds = new Set((attendanceRows ?? []).map((r: any) => r.class_id as string));

  const assignmentIds = (assignmentsDue ?? []).map((a: any) => a.id as string);
  const { data: submissionRows } = assignmentIds.length
    ? await supabase.from('submissions').select('assignment_id, grade_score').in('assignment_id', assignmentIds)
    : { data: [] };
  const gradedCountByAssignment = new Map<string, number>();
  for (const sub of submissionRows ?? []) {
    if ((sub as any).grade_score !== null) {
      const aid = (sub as any).assignment_id as string;
      gradedCountByAssignment.set(aid, (gradedCountByAssignment.get(aid) ?? 0) + 1);
    }
  }

  const assessmentIds = (recentAssessments ?? []).map((a: any) => a.id as string);
  const { data: gradeRows } = assessmentIds.length
    ? await supabase.from('grades').select('assessment_id, score').in('assessment_id', assessmentIds)
    : { data: [] };
  const gradedCountByAssessment = new Map<string, number>();
  for (const g of gradeRows ?? []) {
    if ((g as any).score !== null) {
      const aid = (g as any).assessment_id as string;
      gradedCountByAssessment.set(aid, (gradedCountByAssessment.get(aid) ?? 0) + 1);
    }
  }

  const attendanceItems = Array.from(
    new Map((slots ?? []).map((s: any) => [s.class_id as string, (s.class?.name ?? '') as string])).entries(),
  ).map(([classId, className]) => ({ classId, className, done: markedClassIds.has(classId) }));

  return {
    slots: (slots ?? []).map((s: any) => ({
      id: s.id, startTime: s.start_time, endTime: s.end_time, room: s.room,
      className: s.class?.name ?? '', subjectName: s.subject?.name ?? '',
    })),
    attendanceItems,
    assignmentItems: (assignmentsDue ?? []).map((a: any) => {
      const roster = rosterSizeByClass.get(a.class_id) ?? 0;
      const graded = gradedCountByAssignment.get(a.id) ?? 0;
      return { id: a.id, title: a.title, className: a.class?.name ?? '', done: roster > 0 && graded >= roster };
    }),
    gradeItems: (recentAssessments ?? []).map((a: any) => {
      const roster = rosterSizeByClass.get(a.class_id) ?? 0;
      const graded = gradedCountByAssessment.get(a.id) ?? 0;
      return { id: a.id, name: a.name, className: a.class?.name ?? '', done: roster > 0 && graded >= roster };
    }),
  };
}

type ManualItem = { id: string; label: string; done: boolean };

export default function TodaysChecklist({ teacherId, timezone }: { teacherId: string; timezone: string }) {
  const { dateIso, dayEnum } = useMemo(() => schoolLocalDateParts(timezone), [timezone]);
  const { isModuleEnabled } = useModuleAccess();

  const { data, isLoading } = useQuery({
    queryKey: ['todays-checklist', teacherId, dateIso],
    queryFn: () => fetchChecklistData(teacherId, dateIso, dayEnum),
    enabled: !!teacherId,
  });

  // Manual, non-programmatically-detectable items (e.g. "bring back the
  // permission slips"). Deliberately in-memory only — never persisted to
  // sessionStorage, a server table, or any API — so this resets on every
  // reload and is never visible to anyone but the teacher themself. This is
  // a personal reminder tool, not a surveillance mechanism: do not wire it
  // up to any admin-visible endpoint in a future PR.
  const [manualItems, setManualItems] = useState<ManualItem[]>([]);
  const [manualDraft, setManualDraft] = useState('');

  function addManualItem() {
    if (!manualDraft.trim()) return;
    setManualItems((prev) => [...prev, { id: crypto.randomUUID(), label: manualDraft.trim(), done: false }]);
    setManualDraft('');
  }
  function toggleManualItem(id: string) {
    setManualItems((prev) => prev.map((i) => (i.id === id ? { ...i, done: !i.done } : i)));
  }
  function removeManualItem(id: string) {
    setManualItems((prev) => prev.filter((i) => i.id !== id));
  }

  const hasClassesToday = (data?.slots.length ?? 0) > 0;
  const showGrades = isModuleEnabled('assessments');

  return (
    <section className="bg-white border border-slate-100 rounded-2xl shadow-sm p-5 space-y-4">
      <h2 className="text-base font-semibold text-slate-700">Today's Checklist</h2>

      {isLoading ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : !hasClassesToday ? (
        <p className="text-sm text-slate-500">No classes scheduled today. Enjoy your day.</p>
      ) : (
        <div className="space-y-4">
          <ChecklistGroup title="Today's classes">
            {data!.slots.map((s) => (
              <li key={s.id} className="flex items-center gap-2 text-sm text-slate-600">
                <span className="text-slate-400 text-xs w-24 shrink-0">{formatTime(s.startTime)}–{formatTime(s.endTime)}</span>
                <span className="font-medium text-slate-700">{s.subjectName}</span>
                <span className="text-slate-400">· {s.className}</span>
                <span className="text-slate-400">· {s.room ?? 'Room not set'}</span>
              </li>
            ))}
          </ChecklistGroup>

          <ChecklistGroup title="Attendance to mark">
            {data!.attendanceItems.map((item) => (
              <ChecklistRow key={item.classId} done={item.done} href={`/teacher/attendance?classId=${item.classId}&date=${dateIso}`}>
                Mark attendance — {item.className}
              </ChecklistRow>
            ))}
          </ChecklistGroup>

          {data!.assignmentItems.length > 0 && (
            <ChecklistGroup title="Assignments due today">
              {data!.assignmentItems.map((item) => (
                <ChecklistRow key={item.id} done={item.done} href="/teacher/assignments">
                  {item.title} — {item.className}
                </ChecklistRow>
              ))}
            </ChecklistGroup>
          )}

          {showGrades && data!.gradeItems.length > 0 && (
            <ChecklistGroup title="Pending grade entries">
              {data!.gradeItems.map((item) => (
                <ChecklistRow key={item.id} done={item.done} href="/teacher/gradebook">
                  {item.name} — {item.className}
                </ChecklistRow>
              ))}
            </ChecklistGroup>
          )}
        </div>
      )}

      {/* Manual items — personal, in-memory only (see comment above). */}
      <div className="pt-2 border-t border-slate-100">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">Personal notes</p>
        <ul className="space-y-1.5 mb-2">
          {manualItems.map((item) => (
            <li key={item.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={item.done} onChange={() => toggleManualItem(item.id)} className="accent-slate-700" />
              <span className={item.done ? 'line-through text-slate-400' : 'text-slate-600'}>{item.label}</span>
              <button type="button" onClick={() => removeManualItem(item.id)} className="ml-auto text-xs text-slate-300 hover:text-slate-500">✕</button>
            </li>
          ))}
        </ul>
        <div className="flex gap-2">
          <input
            type="text" value={manualDraft} onChange={(e) => setManualDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addManualItem(); } }}
            placeholder="Add a reminder for yourself…"
            className="flex-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm"
          />
          <button type="button" onClick={addManualItem} className="text-xs font-medium border border-slate-300 px-3 py-1.5 rounded-md hover:bg-slate-50">Add</button>
        </div>
      </div>
    </section>
  );
}

function ChecklistGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-1.5">{title}</p>
      <ul className="space-y-1.5">{children}</ul>
    </div>
  );
}

function ChecklistRow({ done, href, children }: { done: boolean; href: string; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={done} readOnly className="accent-emerald-600" />
      <Link href={href} className={`hover:underline ${done ? 'text-slate-400 line-through' : 'text-slate-700'}`}>
        {children}
      </Link>
    </li>
  );
}
