import { createClient } from '@/lib/supabase/server';
import BackButton from '@/components/BackButton';
import EventsClient from './EventsClient';

export default async function AdminEventsPage() {
  const supabase = createClient();

  const [{ data: events }, { data: classes }] = await Promise.all([
    supabase
      .from('events')
      .select('id, title, description, starts_at, ends_at, all_day, event_type, audience, target_grade_level, target_class_id')
      .order('starts_at', { ascending: true }),
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
          <h1 className="text-2xl font-semibold">Events</h1>
          <p className="text-sm text-slate-500 mt-0.5">Manage the school calendar. Export to Google or Apple Calendar via .ics.</p>
        </div>
      </div>
      <EventsClient events={(events ?? []) as any[]} classes={classes ?? []} />
    </div>
  );
}
