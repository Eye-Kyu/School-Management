import BackButton from '@/components/BackButton';
import { createClient } from '@/lib/supabase/server';
import TimetableClient from './TimetableClient';

export default async function TimetablePage() {
  const supabase = createClient();

  const [{ data: classes }, { data: subjects }, { data: teachers }, { data: slots }] =
    await Promise.all([
      supabase.from('classes').select('id, name, grade_level').eq('is_active', true).order('grade_level').order('name'),
      supabase.from('subjects').select('id, name, code').order('name'),
      supabase.from('teachers').select('id, user:users!inner(full_name)').order('created_at'),
      supabase.from('timetable_slots').select(`
        id, day_of_week, start_time, end_time, room,
        class:classes(id, name),
        subject:subjects(id, name, code),
        teacher:teachers!inner(id, user:users!inner(full_name))
      `).order('day_of_week').order('start_time'),
    ]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <BackButton href="/admin" />
        <div>
          <h1 className="text-2xl font-semibold">Timetable</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {slots?.length ?? 0} slots across all classes
          </p>
        </div>
      </div>
      <TimetableClient
        initialSlots={(slots ?? []) as any}
        classes={classes ?? []}
        subjects={subjects ?? []}
        teachers={(teachers ?? []) as any}
      />
    </div>
  );
}
