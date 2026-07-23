import BackButton from '@/components/BackButton';
import { createClient } from '@/lib/supabase/server';
import DepartmentsClient from './DepartmentsClient';

export default async function DepartmentsPage() {
  const supabase = createClient();
  const { data: departments } = await supabase
    .from('departments')
    .select('id, name, description, teachers(count)')
    .is('deleted_at', null)
    .order('name');

  const rows = (departments ?? []).map((d) => ({
    id: d.id as string,
    name: d.name as string,
    description: d.description as string | null,
    teacher_count: (d.teachers as unknown as { count: number }[] | null)?.[0]?.count ?? 0,
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
      <DepartmentsClient initialDepartments={rows} />
    </div>
  );
}
