import { createClient } from '@/lib/supabase/server';
import BackButton from '@/components/BackButton';
import DocumentsClient from './DocumentsClient';

export default async function SchoolWideDocumentsPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: userRow } = await supabase
    .from('users').select('id, role').eq('auth_id', user.id).maybeSingle();
  const role = (userRow?.role as string) ?? '';

  let classes: { id: string; name: string }[] = [];
  let subjects: { id: string; name: string }[] = [];
  if (role === 'TEACHER' || role === 'ADMIN') {
    const [{ data: classRows }, { data: subjectRows }] = await Promise.all([
      supabase.from('classes').select('id, name').eq('is_active', true).order('name'),
      supabase.from('subjects').select('id, name').order('name'),
    ]);
    classes = classRows ?? [];
    subjects = subjectRows ?? [];
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <BackButton href={`/${role.toLowerCase()}`} />
        <div>
          <h1 className="text-2xl font-semibold">Documents</h1>
          <p className="text-sm text-slate-500 mt-0.5">School-wide documents shared with everyone.</p>
        </div>
      </div>
      <DocumentsClient role={role} classes={classes} subjects={subjects} />
    </div>
  );
}
