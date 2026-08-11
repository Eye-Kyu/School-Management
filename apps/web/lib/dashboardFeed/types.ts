export type FeedAlertItem = {
  id: string;
  kind: 'notification';
  title: string;
  body: string;
  timestamp: string;
  isRead: boolean;
  href: string;
  notifType: string;
  acknowledgedAt: string | null;
};

export type FeedConversationItem = {
  id: string;
  otherPartyName: string;
  preview: string;
  timestamp: string;
  unreadCount: number;
  href: string;
};

export type FeedReminderItem = {
  id: string;
  title: string;
  subtitle: string;
  dueDate: string;
  href: string;
  badge?: string;
};

export type DashboardFeedResponse = {
  alerts: FeedAlertItem[];
  conversations: FeedConversationItem[];
  reminders: FeedReminderItem[];
};

export type FeedSource = 'alerts' | 'conversations' | 'reminders';

/** One normalized shape the feed UI renders/sorts, regardless of which of
 * the three backend sections an item came from. */
export type FeedEntry = {
  id: string;
  source: FeedSource;
  title: string;
  body: string;
  timestamp: string;
  isRead: boolean;
  href: string;
  badge?: string;
};

export function toFeedEntries(feed: DashboardFeedResponse): FeedEntry[] {
  const alerts: FeedEntry[] = feed.alerts.map((a) => ({
    id: a.id, source: 'alerts', title: a.title, body: a.body, timestamp: a.timestamp, isRead: a.isRead, href: a.href,
  }));
  const conversations: FeedEntry[] = feed.conversations.map((c) => ({
    id: c.id, source: 'conversations', title: c.otherPartyName, body: c.preview, timestamp: c.timestamp, isRead: false, href: c.href,
  }));
  const reminders: FeedEntry[] = feed.reminders.map((r) => ({
    id: r.id, source: 'reminders', title: r.title, body: r.subtitle, timestamp: r.dueDate, isRead: false, href: r.href, badge: r.badge,
  }));
  return [...alerts, ...conversations, ...reminders];
}
