import BackButton from '@/components/BackButton';
import { createClient } from '@/lib/supabase/server';
import StudentsClient from './StudentsClient';

export default async function StudentsPage() {
  const supabase = createClient();
  const [{ data: students }, { data: classes }] = await Promise.all([
    supabase
      .from('students')
      .select('id, admission_no, user:users!user_id(id, full_name, email, phone), class:classes!current_class_id(id, name)')
      .eq('is_active', true)
      .order('admission_no'),
    supabase.from('classes').select('id, name, grade_level').eq('is_active', true).order('grade_level').order('name'),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <BackButton href="/admin" />
        <div>
          <h1 className="text-2xl font-semibold">Students</h1>
          <p className="text-sm text-slate-500 mt-0.5">{students?.length ?? 0} enrolled students</p>
        </div>
      </div>
      <StudentsClient initialStudents={(students ?? []) as any} classes={classes ?? []} />
    </div>
  );
}
