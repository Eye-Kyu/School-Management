import { createClient } from '@/lib/supabase/server';
import BackButton from '@/components/BackButton';
import AnnouncementsClient from './AnnouncementsClient';

export default async function AdminAnnouncementsPage() {
  const supabase = createClient();

  const [{ data: announcements }, { data: classes }] = await Promise.all([
    supabase
      .from('announcements')
      .select('id, title, body, audience, target_grade_level, target_class_id, published_at, author:users!inner(full_name)')
      .order('published_at', { ascending: false }),
    supabase
      .from('classes')
      .select('id, name, grade_level')
      .eq('is_active', true)
      .order('name'),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <BackButton href="/admin" />
        <div>
          <h1 className="text-2xl font-semibold">Announcements</h1>
          <p className="text-sm text-slate-500 mt-0.5">Post school-wide or targeted notices.</p>
        </div>
      </div>

      <AnnouncementsClient announcements={(announcements ?? []) as any[]} classes={classes ?? []} />
    </div>
  );
}
