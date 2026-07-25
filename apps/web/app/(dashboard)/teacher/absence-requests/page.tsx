import BackButton from '@/components/BackButton';
import { createClient } from '@/lib/supabase/server';
import AbsenceRequestReviewQueue from '@/components/AbsenceRequestReviewQueue';

export default async function TeacherAbsenceRequestsPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: userRow } = await supabase.from('users').select('id').eq('auth_id', user.id).maybeSingle();
  const { data: teacherRow } = userRow
    ? await supabase.from('teachers').select('is_class_teacher_of').eq('user_id', userRow.id).maybeSingle()
    : { data: null };

  const isClassTeacher = !!teacherRow?.is_class_teacher_of;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <BackButton href="/teacher" />
        <div>
          <h1 className="text-2xl font-semibold">Absence requests</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {isClassTeacher ? 'Review absence requests for students in your class.' : 'Only your class’s Class Teacher or the School Admin can review absence requests.'}
          </p>
        </div>
      </div>
      {isClassTeacher ? (
        <AbsenceRequestReviewQueue />
      ) : (
        <div className="rounded-xl border border-dashed border-slate-200 bg-white p-6 text-center text-sm text-slate-400">
          You are not a Class Teacher, so there is nothing to review here.
        </div>
      )}
    </div>
  );
}
