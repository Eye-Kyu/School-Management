import { createClient } from '@/lib/supabase/server';
import BackButton from '@/components/BackButton';
import BehaviorIncidentsClient from './BehaviorIncidentsClient';

export default async function TeacherBehaviorIncidentsPage() {
  const supabase = createClient();
  const { data: reports } = await supabase
    .from('behavior_incident_reports')
    .select('id, student_id, category, description, status, class_teacher_notes, created_at, reported_by:users!reported_by_user_id(full_name), student:students!inner(admission_no, user:users!inner(full_name))')
    .order('created_at', { ascending: false });

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <BackButton href="/teacher" />
        <div>
          <h1 className="text-2xl font-semibold">Behavior incident reports</h1>
          <p className="text-sm text-slate-500 mt-0.5">Reports submitted by prefects for students in your class.</p>
        </div>
      </div>
      <BehaviorIncidentsClient initialReports={(reports ?? []) as never} />
    </div>
  );
}
