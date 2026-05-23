import BackButton from '@/components/BackButton';
import { createClient } from '@/lib/supabase/server';
import SubjectsClient from './SubjectsClient';

export default async function SubjectsPage() {
  const supabase = createClient();
  const { data: subjects } = await supabase
    .from('subjects')
    .select('id, name, code')
    .order('name');

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <BackButton href="/admin" />
        <div>
          <h1 className="text-2xl font-semibold">Subjects</h1>
          <p className="text-sm text-slate-500 mt-0.5">{subjects?.length ?? 0} subjects</p>
        </div>
      </div>
      <SubjectsClient initialSubjects={subjects ?? []} />
    </div>
  );
}
