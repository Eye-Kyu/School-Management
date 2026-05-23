import BackButton from '@/components/BackButton';
import { createClient } from '@/lib/supabase/server';
import ClassesClient from './ClassesClient';

export default async function ClassesPage() {
  const supabase = createClient();
  const { data: classes } = await supabase
    .from('classes')
    .select('id, name, grade_level, stream, is_active')
    .eq('is_active', true)
    .order('grade_level')
    .order('name');

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <BackButton href="/admin" />
        <div>
          <h1 className="text-2xl font-semibold">Classes</h1>
          <p className="text-sm text-slate-500 mt-0.5">{classes?.length ?? 0} active classes</p>
        </div>
      </div>
      <ClassesClient initialClasses={classes ?? []} />
    </div>
  );
}
