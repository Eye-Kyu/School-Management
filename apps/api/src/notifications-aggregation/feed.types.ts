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

export type Role = 'ADMIN' | 'TEACHER' | 'STUDENT' | 'PARENT' | 'SUPER_ADMIN';
