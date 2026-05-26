import { createClient } from '@/lib/supabase/server';
import BackButton from '@/components/BackButton';
import NotificationsMarkRead from './NotificationsMarkRead';

type Notification = {
  id: string;
  type: string;
  title: string;
  body: string;
  is_read: boolean;
  created_at: string;
};

function groupByDay(items: Notification[]) {
  const today = new Date().toDateString();
  const yesterday = new Date(Date.now() - 86400000).toDateString();

  const groups: { label: string; items: Notification[] }[] = [
    { label: 'Today', items: [] },
    { label: 'Yesterday', items: [] },
    { label: 'Earlier', items: [] },
  ];

  for (const n of items) {
    const d = new Date(n.created_at).toDateString();
    const bucket = d === today ? groups[0] : d === yesterday ? groups[1] : groups[2];
    bucket!.items.push(n);
  }

  return groups.filter((g) => g.items.length > 0);
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return new Date(iso).toLocaleDateString('en-KE', { day: 'numeric', month: 'short' });
}

export default async function NotificationsPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: userRow } = await supabase
    .from('users')
    .select('id')
    .eq('auth_id', user.id)
    .maybeSingle();

  let notifications: Notification[] = [];

  if (userRow) {
    const { data } = await supabase
      .from('notifications')
      .select('id, type, title, body, is_read, created_at')
      .order('created_at', { ascending: false })
      .limit(50);
    notifications = data ?? [];
  }

  const unreadIds = notifications.filter((n) => !n.is_read).map((n) => n.id);
  const groups = groupByDay(notifications);

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-4">
        <BackButton href="/" />
        <div>
          <h1 className="text-2xl font-semibold">Notifications</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {notifications.length === 0
              ? 'You have no notifications yet.'
              : `${unreadIds.length} unread`}
          </p>
        </div>
      </div>

      {/* Mark all unread as read on load */}
      {unreadIds.length > 0 && <NotificationsMarkRead ids={unreadIds} />}

      {notifications.length === 0 && (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center text-slate-400 text-sm">
          No notifications yet.
        </div>
      )}

      {groups.map((group) => (
        <section key={group.label} className="space-y-2">
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wide px-1">
            {group.label}
          </h2>
          <div className="space-y-1">
            {group.items.map((n) => (
              <div
                key={n.id}
                className={`rounded-lg border bg-white px-4 py-3 ${
                  n.is_read ? 'border-slate-200' : 'border-blue-200 bg-blue-50/40'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm font-medium ${n.is_read ? 'text-slate-700' : 'text-slate-900'}`}>
                      {n.title}
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{n.body}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {!n.is_read && (
                      <span className="h-2 w-2 rounded-full bg-blue-500" />
                    )}
                    <span className="text-xs text-slate-400">{timeAgo(n.created_at)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
