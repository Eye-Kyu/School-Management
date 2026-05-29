import { createClient } from '@/lib/supabase/server';
import BackButton from '@/components/BackButton';
import PermissionSlipSigner from './PermissionSlipSigner';

export default async function ParentPermissionSlipsPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: userRow } = await supabase
    .from('users').select('id').eq('auth_id', user.id).maybeSingle();

  // Parent's linked students
  const { data: guardians } = await supabase
    .from('guardians')
    .select('student_id, student:students!student_id(id, current_class_id, user:users!user_id(full_name))')
    .eq('user_id', userRow?.id ?? '');

  const studentIds = (guardians ?? []).map((g) => g.student_id);

  // All permission slips for this school
  const { data: slips } = await supabase
    .from('permission_slips')
    .select('id, title, description, audience, target_class_id, response_deadline, one_time_code, created_at')
    .order('created_at', { ascending: false });

  // Which slips this parent has already signed for their children
  const { data: responses } = studentIds.length
    ? await supabase
        .from('permission_slip_responses')
        .select('slip_id, student_id')
        .in('student_id', studentIds)
    : { data: [] };

  const signedSet = new Set((responses ?? []).map((r) => `${r.slip_id}:${r.student_id}`));

  const students = (guardians ?? []).map((g) => ({
    id: g.student_id,
    name: ((g.student as any)?.user?.full_name ?? '—') as string,
    classId: ((g.student as any)?.current_class_id ?? '') as string,
  }));

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-4">
        <BackButton href="/parent" />
        <div>
          <h1 className="text-2xl font-semibold">Permission slips</h1>
          <p className="text-sm text-slate-500 mt-0.5">Sign permission slips for your child using the code from the school.</p>
        </div>
      </div>
      <PermissionSlipSigner
        slips={(slips ?? []) as any[]}
        students={students}
        signedSet={[...signedSet]}
        parentUserId={userRow?.id ?? ''}
      />
    </div>
  );
}
