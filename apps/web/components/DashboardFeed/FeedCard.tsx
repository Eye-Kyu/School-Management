'use client';

import Link from 'next/link';
import { cn } from '@school-manager/ui';
import { FeedIcon } from './FeedIcon';
import type { FeedEntry } from '@/lib/dashboardFeed/types';
import type { FeedDensity } from '@/lib/hooks/useDashboardFeedPrefs';
import { timeAgo } from '@/lib/utils/timeAgo';

export function FeedCard({
  entry, density, onMarkRead,
}: {
  entry: FeedEntry;
  density: FeedDensity;
  onMarkRead: (entry: FeedEntry) => void;
}) {
  const compact = density === 'compact';

  return (
    <div
      className={cn(
        'group relative bg-white border border-slate-200 border-l-4 rounded-r-xl transition-[box-shadow,border-color] duration-200 ease-out hover:shadow-card',
        entry.isRead ? 'border-l-slate-200' : 'border-l-role',
        compact ? 'px-4 py-2' : 'px-5 py-4',
      )}
    >
      <Link href={entry.href} className="flex items-start gap-3 min-w-0">
        <FeedIcon source={entry.source} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className={cn('font-medium text-slate-900', entry.isRead ? 'font-normal text-slate-700' : '', compact ? 'text-sm' : 'text-[15px]')}>
              {entry.title}
            </p>
            {entry.badge && (
              <span className="text-[11px] font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">
                {entry.badge}
              </span>
            )}
          </div>
          {!compact && entry.body && (
            <p className="text-sm text-slate-500 mt-1 line-clamp-2 leading-relaxed">{entry.body}</p>
          )}
          {compact && entry.body && (
            <p className="text-xs text-slate-500 mt-0.5 line-clamp-1">{entry.body}</p>
          )}
          {entry.timestamp && (
            <p className="text-xs text-slate-500 mt-1">{timeAgo(entry.timestamp)}</p>
          )}
        </div>
      </Link>

      {!entry.isRead && entry.source !== 'reminders' && (
        <button
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onMarkRead(entry); }}
          className={cn(
            'absolute top-3 right-3 text-xs text-slate-500 hover:text-slate-800',
            'opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity duration-150',
          )}
          aria-label={`Mark "${entry.title}" as read`}
        >
          Mark read
        </button>
      )}
    </div>
  );
}
