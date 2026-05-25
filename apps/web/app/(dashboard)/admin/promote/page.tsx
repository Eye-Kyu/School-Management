import { createClient } from '@/lib/supabase/server';
import BackButton from '@/components/BackButton';
import PromoteClient from './PromoteClient';

export default async function PromotePage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const [{ data: classes }, { data: students }] = await Promise.all([
    supabase
      .from('classes')
      .select('id, name, grade_level, stream')
      .eq('is_active', true)
      .order('grade_level')
      .order('name'),
    supabase
      .from('students')
      .select('current_class_id')
      .eq('is_active', true),
  ]);

  // Count active students per class
  const countByClass: Record<string, number> = {};
  for (const s of students ?? []) {
    if (s.current_class_id) {
      countByClass[s.current_class_id] = (countByClass[s.current_class_id] ?? 0) + 1;
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <BackButton href="/admin" />
        <div>
          <h1 className="text-2xl font-semibold">Promote students</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Move all students from one class to the next, or graduate final-year students.
            Run this once at the end of the academic year.
          </p>
        </div>
      </div>

      <PromoteClient
        classes={(classes ?? []) as any[]}
        countByClass={countByClass}
      />
    </div>
  );
}
