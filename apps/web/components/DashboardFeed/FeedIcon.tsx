import type { FeedSource } from '@/lib/dashboardFeed/types';

// Monochrome, icon + text-label per source — deliberately not color-coded by
// source (that becomes visual noise per the design spec); only the unread
// left-border accent on FeedCard carries color meaning.
const ICONS: Record<FeedSource, { label: string; path: React.ReactNode }> = {
  alerts: {
    label: 'Alert',
    path: <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.4-1.4A2 2 0 0 1 18 14.2V11a6 6 0 0 0-4-5.65V5a2 2 0 1 0-4 0v.35A6 6 0 0 0 6 11v3.2a2 2 0 0 1-.6 1.4L4 17h5m6 0v1a3 3 0 1 1-6 0v-1m6 0H9" />,
  },
  conversations: {
    label: 'Message',
    path: <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.86 9.86 0 0 1-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8Z" />,
  },
  reminders: {
    label: 'Reminder',
    path: <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />,
  },
};

export function FeedIcon({ source }: { source: FeedSource }) {
  const { label, path } = ICONS[source];
  return (
    <div className="flex flex-col items-center gap-1 w-11 shrink-0">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5 text-slate-400" aria-hidden="true">
        {path}
      </svg>
      <span className="text-[10px] leading-none text-slate-400">{label}</span>
    </div>
  );
}
