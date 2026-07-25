import BackButton from '@/components/BackButton';
import { createClient } from '@/lib/supabase/server';
import PrefectsClient from './PrefectsClient';

export default async function AdminPrefectsPage() {
  const supabase = createClient();

  const [{ data: classes }, { data: classPrefects }, { data: schoolPrefects }, { data: students }] = await Promise.all([
    supabase.from('classes').select('id, name, grade_level').eq('is_active', true).order('grade_level').order('name'),
    supabase
      .from('class_prefects')
      .select('id, class_id, student_id, term_id, assigned_at, student:students!inner(admission_no, user:users!inner(full_name))')
      .is('revoked_at', null),
    supabase
      .from('school_prefects')
      .select('id, student_id, role_title, term_id, assigned_at, revoked_at, revocation_reason, student:students!inner(admission_no, user:users!inner(full_name))')
      .order('assigned_at', { ascending: false }),
    supabase
      .from('students')
      .select('id, admission_no, current_class_id, user:users!inner(full_name)')
      .eq('is_active', true)
      .order('admission_no'),
  ]);

  const byClass = new Map((classPrefects ?? []).map((p) => [p.class_id, p]));
  const classRows = (classes ?? []).map((c) => ({ ...c, prefect: byClass.get(c.id) ?? null }));

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <BackButton href="/admin" />
        <div>
          <h1 className="text-2xl font-semibold">Prefects</h1>
          <p className="text-sm text-slate-500 mt-0.5">Class Prefects and School Prefects for this school.</p>
        </div>
      </div>
      <PrefectsClient
        initialClassRows={classRows as never}
        initialSchoolPrefects={(schoolPrefects ?? []) as never}
        students={(students ?? []) as never}
      />
    </div>
  );
}
