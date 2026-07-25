import { createClient } from '@/lib/supabase/server';
import BackButton from '@/components/BackButton';
import AbsenceRequestsClient from './AbsenceRequestsClient';

export default async function ParentAbsenceRequestsPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: userRow } = await supabase
    .from('users').select('id').eq('auth_id', user.id).maybeSingle();

  const { data: guardians } = await supabase
    .from('guardians')
    .select('student_id, student:students!student_id(id, user:users!user_id(full_name))')
    .eq('user_id', userRow?.id ?? '');

  const students = (guardians ?? []).map((g) => ({
    id: g.student_id as string,
    name: ((g.student as any)?.user?.full_name ?? '—') as string,
  }));

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-4">
        <BackButton href="/parent" />
        <div>
          <h1 className="text-2xl font-semibold">Absence requests</h1>
          <p className="text-sm text-slate-500 mt-0.5">Request an excused absence for a date range — once approved, those days are automatically marked Excused.</p>
        </div>
      </div>
      <AbsenceRequestsClient students={students} />
    </div>
  );
}
