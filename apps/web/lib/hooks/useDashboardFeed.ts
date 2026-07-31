'use client';

// =============================================================================
// useDashboardFeed - the shared "what's new for you" feed, and its mutations
// =============================================================================
// Backs both the notification bell's unread badge and the dashboard feed
// component off the SAME react-query cache entry, so a mark-read mutation
// fired from the feed updates the bell immediately (and vice versa) without
// either needing to know about the other.
// =============================================================================

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import type { DashboardFeedResponse, FeedAlertItem, FeedConversationItem } from '@/lib/dashboardFeed/types';

export const DASHBOARD_FEED_QUERY_KEY = ['dashboard-feed'] as const;
export const DASHBOARD_FEED_UNREAD_COUNT_QUERY_KEY = ['dashboard-feed', 'unread-count'] as const;

export function useDashboardFeed() {
  return useQuery({
    queryKey: DASHBOARD_FEED_QUERY_KEY,
    queryFn: () => apiFetch<DashboardFeedResponse>('/dashboard-feed'),
    staleTime: 60_000, // matches the backend's own per-user cache TTL
    refetchOnWindowFocus: true,
  });
}

export function useDashboardFeedUnreadCount() {
  return useQuery({
    queryKey: DASHBOARD_FEED_UNREAD_COUNT_QUERY_KEY,
    queryFn: () => apiFetch<{ count: number }>('/dashboard-feed/unread-count'),
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });
}

function invalidateFeedQueries(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: DASHBOARD_FEED_QUERY_KEY });
  qc.invalidateQueries({ queryKey: DASHBOARD_FEED_UNREAD_COUNT_QUERY_KEY });
}

/** Marks one or more alert/notification ids read (accepts `pm:`-prefixed
 * platform-message-recipient ids too — the endpoint handles both). */
export function useMarkFeedItemsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => apiFetch('/dashboard-feed/read', { method: 'PATCH', body: JSON.stringify({ ids }) }),
    onMutate: async (ids: string[]) => {
      await qc.cancelQueries({ queryKey: DASHBOARD_FEED_QUERY_KEY });
      const previous = qc.getQueryData<DashboardFeedResponse>(DASHBOARD_FEED_QUERY_KEY);
      if (previous) {
        qc.setQueryData<DashboardFeedResponse>(DASHBOARD_FEED_QUERY_KEY, {
          ...previous,
          alerts: previous.alerts.map((a) => (ids.includes(a.id) ? { ...a, isRead: true } : a)),
        });
      }
      return { previous };
    },
    onError: (_err, _ids, context) => {
      if (context?.previous) qc.setQueryData(DASHBOARD_FEED_QUERY_KEY, context.previous);
    },
    onSettled: () => invalidateFeedQueries(qc),
  });
}

/** Marks a conversation's unread thread as read (removes it from the feed). */
export function useMarkConversationRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (conversationId: string) => apiFetch(`/messaging/conversations/${conversationId}/read`, { method: 'PATCH' }),
    onMutate: async (conversationId: string) => {
      await qc.cancelQueries({ queryKey: DASHBOARD_FEED_QUERY_KEY });
      const previous = qc.getQueryData<DashboardFeedResponse>(DASHBOARD_FEED_QUERY_KEY);
      if (previous) {
        qc.setQueryData<DashboardFeedResponse>(DASHBOARD_FEED_QUERY_KEY, {
          ...previous,
          conversations: previous.conversations.filter((c) => c.id !== conversationId),
        });
      }
      return { previous };
    },
    onError: (_err, _id, context) => {
      if (context?.previous) qc.setQueryData(DASHBOARD_FEED_QUERY_KEY, context.previous);
    },
    onSettled: () => invalidateFeedQueries(qc),
  });
}

/** Marks every currently-unread alert and every visible conversation as read in one go. */
export function useMarkAllFeedRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ alerts, conversations }: { alerts: FeedAlertItem[]; conversations: FeedConversationItem[] }) => {
      const unreadIds = alerts.filter((a) => !a.isRead).map((a) => a.id);
      await Promise.all([
        unreadIds.length > 0 ? apiFetch('/dashboard-feed/read', { method: 'PATCH', body: JSON.stringify({ ids: unreadIds }) }) : Promise.resolve(),
        ...conversations.map((c) => apiFetch(`/messaging/conversations/${c.id}/read`, { method: 'PATCH' })),
      ]);
    },
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: DASHBOARD_FEED_QUERY_KEY });
      const previous = qc.getQueryData<DashboardFeedResponse>(DASHBOARD_FEED_QUERY_KEY);
      if (previous) {
        qc.setQueryData<DashboardFeedResponse>(DASHBOARD_FEED_QUERY_KEY, {
          ...previous,
          alerts: previous.alerts.map((a) => ({ ...a, isRead: true })),
          conversations: [],
        });
      }
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) qc.setQueryData(DASHBOARD_FEED_QUERY_KEY, context.previous);
    },
    onSettled: () => invalidateFeedQueries(qc),
  });
}
