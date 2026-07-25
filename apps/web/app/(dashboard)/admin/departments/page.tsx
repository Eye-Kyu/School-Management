import BackButton from '@/components/BackButton';
import { createClient } from '@/lib/supabase/server';
import DepartmentsClient from './DepartmentsClient';

export default async function DepartmentsPage() {
  const supabase = createClient();
  const [{ data: departments }, { data: teachers }] = await Promise.all([
    supabase
      .from('departments')
      .select('id, name, description, department_head_user_id, teachers(count), head:users!department_head_user_id(id, full_name)')
      .is('deleted_at', null)
      .order('name'),
    supabase
      .from('teachers')
      .select('user_id, department_id, user:users!inner(full_name)'),
  ]);

  const rows = (departments ?? []).map((d) => ({
    id: d.id as string,
    name: d.name as string,
    description: d.description as string | null,
    department_head_user_id: d.department_head_user_id as string | null,
    head_name: (d.head as unknown as { full_name: string } | null)?.full_name ?? null,
    teacher_count: (d.teachers as unknown as { count: number }[] | null)?.[0]?.count ?? 0,
  }));

  const teacherRows = (teachers ?? []).map((t: any) => ({
    userId: t.user_id as string,
    departmentId: t.department_id as string | null,
    fullName: t.user?.full_name as string ?? '',
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <BackButton href="/admin" />
        <div>
          <h1 className="text-2xl font-semibold">Departments</h1>
          <p className="text-sm text-slate-500 mt-0.5">{rows.length} department{rows.length !== 1 ? 's' : ''}</p>
        </div>
      </div>
      <DepartmentsClient initialDepartments={rows} teachers={teacherRows} />
    </div>
  );
}
