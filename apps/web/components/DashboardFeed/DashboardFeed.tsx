'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@school-manager/ui';
import {
  useDashboardFeed, useMarkFeedItemsRead, useMarkConversationRead, useMarkAllFeedRead,
} from '@/lib/hooks/useDashboardFeed';
import { useDashboardFeedPrefs, type FeedFilter } from '@/lib/hooks/useDashboardFeedPrefs';
import { toFeedEntries, type FeedEntry } from '@/lib/dashboardFeed/types';
import { sortFeed } from '@/lib/dashboardFeed/sortFeed';
import { FeedCard } from './FeedCard';

const FILTERS: { value: FeedFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'alerts', label: 'Alerts' },
  { value: 'conversations', label: 'Conversations' },
  { value: 'reminders', label: 'Reminders' },
];

const READ_ITEMS_PAGE_SIZE = 20;

export function DashboardFeed({ userId, role }: { userId: string; role: string }) {
  const { data, isLoading, isFetching, refetch } = useDashboardFeed();
  const { filter, density, setFilter, setDensity } = useDashboardFeedPrefs(userId, role);
  const markItemsRead = useMarkFeedItemsRead();
  const markConversationRead = useMarkConversationRead();
  const markAllRead = useMarkAllFeedRead();
  const [showMoreRead, setShowMoreRead] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Escape-to-close + focus-return for the mobile bulk-actions popover —
  // same idiom as PaybillDashboard.tsx's modals, the only other overlay
  // interaction in this app.
  useEffect(() => {
    if (!mobileMenuOpen) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setMobileMenuOpen(false);
        menuButtonRef.current?.focus();
      }
    }
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node) && e.target !== menuButtonRef.current) {
        setMobileMenuOpen(false);
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [mobileMenuOpen]);

  const entries = useMemo(() => (data ? sortFeed(toFeedEntries(data)) : []), [data]);
  const filtered = filter === 'all' ? entries : entries.filter((e) => e.source === filter);
  const unread = filtered.filter((e) => !e.isRead);
  const read = filtered.filter((e) => e.isRead);
  const visibleRead = showMoreRead ? read : read.slice(0, READ_ITEMS_PAGE_SIZE);
  const visible = [...unread, ...visibleRead];
  const hasMoreRead = !showMoreRead && read.length > READ_ITEMS_PAGE_SIZE;
  const canMarkAllRead = data ? data.alerts.some((a) => !a.isRead) || data.conversations.length > 0 : false;

  function handleMarkRead(entry: FeedEntry) {
    if (entry.source === 'conversations') markConversationRead.mutate(entry.id);
    else if (entry.source === 'alerts') markItemsRead.mutate([entry.id]);
  }

  function handleMarkAllRead() {
    if (!data) return;
    markAllRead.mutate({ alerts: data.alerts, conversations: data.conversations });
    setMobileMenuOpen(false);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex gap-2 overflow-x-auto pb-1 -mb-1 sm:flex-wrap sm:overflow-visible">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setFilter(f.value)}
              className={cn(
                'shrink-0 rounded-full px-3 py-1.5 text-sm font-medium transition-colors border',
                filter === f.value
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50',
              )}
              aria-pressed={filter === f.value}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {canMarkAllRead && (
            <button
              onClick={handleMarkAllRead}
              className="hidden sm:inline-flex text-xs font-medium text-slate-500 hover:text-slate-800 px-2 py-1.5"
            >
              Mark all read
            </button>
          )}
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            aria-label="Refresh feed"
            className="p-1.5 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={cn('h-4 w-4', isFetching && 'animate-spin')}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 0 0 4.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 0 1-15.357-2m15.357 2H15" />
            </svg>
          </button>
          <button
            onClick={() => setDensity(density === 'compact' ? 'comfortable' : 'compact')}
            aria-label={density === 'compact' ? 'Switch to comfortable view' : 'Switch to compact view'}
            aria-pressed={density === 'compact'}
            className="p-1.5 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-50"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          {canMarkAllRead && (
            <div className="relative sm:hidden">
              <button
                ref={menuButtonRef}
                onClick={() => setMobileMenuOpen((v) => !v)}
                aria-label="More actions"
                aria-haspopup="true"
                aria-expanded={mobileMenuOpen}
                className="p-1.5 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-50"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6h.01M12 12h.01M12 18h.01" />
                </svg>
              </button>
              {mobileMenuOpen && (
                <div
                  ref={menuRef}
                  role="menu"
                  aria-label="Feed actions"
                  className="absolute right-0 mt-1 w-40 bg-white border border-slate-200 rounded-lg shadow-lg py-1 z-10"
                >
                  <button
                    role="menuitem"
                    onClick={handleMarkAllRead}
                    className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                  >
                    Mark all read
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {isLoading ? (
        <FeedSkeleton />
      ) : visible.length === 0 ? (
        <EmptyState />
      ) : (
        <div className={cn('space-y-2', density === 'compact' && 'space-y-1.5')}>
          {visible.map((entry) => (
            <FeedCard key={entry.id} entry={entry} density={density} onMarkRead={handleMarkRead} />
          ))}
          {hasMoreRead && (
            <button
              onClick={() => setShowMoreRead(true)}
              className="w-full text-center text-sm text-slate-500 hover:text-slate-800 py-2"
            >
              Show more ({read.length - READ_ITEMS_PAGE_SIZE} older)
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="bg-white border border-slate-100 rounded-xl px-6 py-12 text-center">
      <p className="text-sm text-slate-500">You&apos;re all caught up.</p>
    </div>
  );
}

function FeedSkeleton() {
  return (
    <div className="space-y-2 animate-pulse">
      {[0, 1, 2].map((i) => (
        <div key={i} className="bg-white border border-slate-100 rounded-xl px-5 py-4 h-20" />
      ))}
    </div>
  );
}
