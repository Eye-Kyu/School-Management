import BackButton from '@/components/BackButton';
import { createClient } from '@/lib/supabase/server';
import AttendanceRemarksClient from './AttendanceRemarksClient';

export default async function AttendanceRemarksPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: userRow } = await supabase.from('users').select('id').eq('auth_id', user.id).maybeSingle();
  const { data: teacherRow } = userRow
    ? await supabase.from('teachers').select('id, department_id').eq('user_id', userRow.id).maybeSingle()
    : { data: null };

  let isDepartmentHead = false;
  if (teacherRow?.department_id && userRow) {
    const { data: dept } = await supabase.from('departments').select('department_head_user_id').eq('id', teacherRow.department_id).maybeSingle();
    isDepartmentHead = dept?.department_head_user_id === userRow.id;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <BackButton href="/teacher" />
        <div>
          <h1 className="text-2xl font-semibold">Attendance re-marking</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {isDepartmentHead ? 'Review requests from your department, and track your own.' : 'Track your submitted re-marking requests.'}
          </p>
        </div>
      </div>
      <AttendanceRemarksClient isDepartmentHead={isDepartmentHead} myUserId={userRow?.id ?? ''} />
    </div>
  );
}
