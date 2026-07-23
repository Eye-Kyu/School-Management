import BackButton from '@/components/BackButton';
import { createClient } from '@/lib/supabase/server';
import TeachersClient from './TeachersClient';

export default async function TeachersPage() {
  const supabase = createClient();
  const [{ data: teachers }, { data: departments }] = await Promise.all([
    supabase
      .from('teachers')
      .select(`
        id, staff_no, department_id, created_at,
        department_row:departments(id, name),
        user:users!inner(id, full_name, email, phone, is_active)
      `)
      .order('created_at'),
    supabase.from('departments').select('id, name').is('deleted_at', null).order('name'),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <BackButton href="/admin" />
        <div>
          <h1 className="text-2xl font-semibold">Teachers</h1>
          <p className="text-sm text-slate-500 mt-0.5">{teachers?.length ?? 0} teachers</p>
        </div>
      </div>
      <TeachersClient initialTeachers={(teachers ?? []) as any} departments={departments ?? []} />
    </div>
  );
}
