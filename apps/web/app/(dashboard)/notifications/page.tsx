import { createClient } from '@/lib/supabase/server';
import { serverApiFetch } from '@/lib/api/server';
import BackButton from '@/components/BackButton';
import NotificationsView from './NotificationsView';
import type { DashboardFeedResponse } from '@/lib/dashboardFeed/types';

export default async function NotificationsPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const feed = await serverApiFetch<DashboardFeedResponse>('/dashboard-feed');
  const { alerts, conversations, reminders } = feed;

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-4">
        <BackButton href="/" />
        <div>
          <h1 className="text-2xl font-semibold">Notifications</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {alerts.length + conversations.length + reminders.length === 0
              ? 'Nothing to see here.'
              : `${alerts.filter((a) => !a.isRead).length + conversations.length + reminders.length} need your attention`}
          </p>
        </div>
      </div>

      <NotificationsView alerts={alerts} conversations={conversations} reminders={reminders} />
    </div>
  );
}
