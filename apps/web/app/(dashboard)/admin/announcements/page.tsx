import { createClient } from '@/lib/supabase/server';
import BackButton from '@/components/BackButton';
import AnnouncementsClient from './AnnouncementsClient';

export default async function AdminAnnouncementsPage() {
  const supabase = createClient();

  // Keep expired announcements visible here for 30 days past expiry so
  // admins can review/clean them up, then drop them from this view too.
  const gracePeriodStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const [{ data: announcements }, { data: classes }, { data: notifStats }] = await Promise.all([
    supabase
      .from('announcements')
      .select('id, title, body, audience, target_grade_level, target_class_id, published_at, expires_at, author:users!inner(full_name)')
      .or(`expires_at.is.null,expires_at.gte.${gracePeriodStart}`)
      .order('published_at', { ascending: false }),
    supabase
      .from('classes')
      .select('id, name, grade_level')
      .eq('is_active', true)
      .order('name'),
    supabase
      .from('notifications')
      .select('metadata, is_read')
      .eq('type', 'NEW_ANNOUNCEMENT'),
  ]);

  // Build per-announcement delivery stats
  const statsMap: Record<string, { sent: number; read: number }> = {};
  for (const n of notifStats ?? []) {
    const id = (n.metadata as Record<string, string> | null)?.announcementId;
    if (!id) continue;
    if (!statsMap[id]) statsMap[id] = { sent: 0, read: 0 };
    statsMap[id]!.sent++;
    if (n.is_read) statsMap[id]!.read++;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <BackButton href="/admin" />
        <div>
          <h1 className="text-2xl font-semibold">Announcements</h1>
          <p className="text-sm text-slate-500 mt-0.5">Post school-wide or targeted notices.</p>
        </div>
      </div>

      <AnnouncementsClient announcements={(announcements ?? []) as any[]} classes={classes ?? []} statsMap={statsMap} />
    </div>
  );
}
