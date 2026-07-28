'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Badge } from '@school-manager/ui';
import { apiFetch } from '@/lib/api';
import { createClient } from '@/lib/supabase/client';
import AcknowledgeButton from './AcknowledgeButton';

type AlertItem = {
  id: string; kind: 'notification'; title: string; body: string;
  timestamp: string; isRead: boolean; href: string;
  notifType: string; acknowledgedAt: string | null;
};
type ConversationItem = {
  id: string; otherPartyName: string; preview: string; timestamp: string; unreadCount: number; href: string;
};
type ReminderItem = { id: string; title: string; subtitle: string; dueDate: string; href: string };

function timeAgo(iso: string) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return new Date(iso).toLocaleDateString('en-KE', { day: 'numeric', month: 'short' });
}

export default function NotificationsView({
  alerts: initialAlerts, conversations: initialConversations, reminders,
}: {
  alerts: AlertItem[];
  conversations: ConversationItem[];
  reminders: ReminderItem[];
}) {
  const supabase = createClient();
  const [alerts, setAlerts] = useState(initialAlerts);
  const [conversations, setConversations] = useState(initialConversations);
  const markedRef = useRef(false);

  async function markAlertRead(item: AlertItem) {
    setAlerts((prev) => prev.map((a) => a.id === item.id ? { ...a, isRead: true } : a));
    if (item.notifType === 'PLATFORM_MESSAGE') {
      const recipientId = item.id.replace(/^pm:/, '');
      await supabase.from('platform_message_recipients').update({ read_at: new Date().toISOString() }).eq('id', recipientId);
    } else {
      await apiFetch('/notifications/read', { method: 'PATCH', body: JSON.stringify({ ids: [item.id] }) }).catch(() => {});
    }
  }

  async function markConversationRead(conv: ConversationItem) {
    setConversations((prev) => prev.filter((c) => c.id !== conv.id));
    await apiFetch(`/messaging/conversations/${conv.id}/read`, { method: 'PATCH' }).catch(() => {});
  }

  // Mark everything currently visible-and-unread as read after 3s of the page being open.
  useEffect(() => {
    if (markedRef.current) return;
    const t = setTimeout(() => {
      markedRef.current = true;
      const unreadAlerts = initialAlerts.filter((a) => !a.isRead);
      const notifIds = unreadAlerts.filter((a) => a.notifType !== 'PLATFORM_MESSAGE').map((a) => a.id);
      const pmIds = unreadAlerts.filter((a) => a.notifType === 'PLATFORM_MESSAGE').map((a) => a.id.replace(/^pm:/, ''));
      if (notifIds.length > 0) apiFetch('/notifications/read', { method: 'PATCH', body: JSON.stringify({ ids: notifIds }) }).catch(() => {});
      if (pmIds.length > 0) supabase.from('platform_message_recipients').update({ read_at: new Date().toISOString() }).in('id', pmIds).then(() => {});
      if (unreadAlerts.length > 0) setAlerts((prev) => prev.map((a) => ({ ...a, isRead: true })));

      for (const c of initialConversations) {
        apiFetch(`/messaging/conversations/${c.id}/read`, { method: 'PATCH' }).catch(() => {});
      }
      if (initialConversations.length > 0) setConversations([]);
    }, 3000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-4">
      <details open className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <summary className="px-4 py-3 cursor-pointer text-sm font-semibold text-slate-700 flex items-center justify-between">
          Alerts
          <span className="text-xs font-normal text-slate-500">{alerts.length}</span>
        </summary>
        <div className="border-t border-slate-100 divide-y divide-slate-100">
          {alerts.length === 0 ? (
            <p className="px-4 py-6 text-sm text-slate-500 text-center">No alerts.</p>
          ) : alerts.map((a) => (
            <div key={a.id} className={`px-4 py-3 flex items-start justify-between gap-3 ${a.isRead ? '' : 'bg-blue-50/40'}`}>
              <Link href={a.href} className="min-w-0 flex-1">
                {a.notifType === 'PLATFORM_MESSAGE' && (
                  <Badge variant="platformMessage" className="mb-1">From platform team</Badge>
                )}
                <p className={`text-sm font-medium ${a.isRead ? 'text-slate-700' : 'text-slate-900'}`}>{a.title}</p>
                <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{a.body}</p>
                <p className="text-xs text-slate-500 mt-1">{timeAgo(a.timestamp)}</p>
              </Link>
              <div className="flex items-center gap-2 shrink-0">
                {a.notifType === 'ABSENT_STUDENT' && (
                  a.acknowledgedAt
                    ? <span className="text-xs text-emerald-600 font-medium">✓ Acknowledged</span>
                    : <AcknowledgeButton id={a.id} />
                )}
                {!a.isRead && (
                  <button onClick={() => markAlertRead(a)} className="text-xs text-slate-500 hover:text-slate-700">
                    Mark read
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </details>

      <details open className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <summary className="px-4 py-3 cursor-pointer text-sm font-semibold text-slate-700 flex items-center justify-between">
          Conversations
          <span className="text-xs font-normal text-slate-500">{conversations.length}</span>
        </summary>
        <div className="border-t border-slate-100 divide-y divide-slate-100">
          {conversations.length === 0 ? (
            <p className="px-4 py-6 text-sm text-slate-500 text-center">No unread conversations.</p>
          ) : conversations.map((c) => (
            <div key={c.id} className="px-4 py-3 flex items-start justify-between gap-3 bg-blue-50/40">
              <Link href={c.href} className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-900">{c.otherPartyName}</p>
                <p className="text-xs text-slate-500 mt-0.5 line-clamp-1">{c.preview}</p>
                <p className="text-xs text-slate-500 mt-1">{timeAgo(c.timestamp)} · {c.unreadCount} unread</p>
              </Link>
              <button onClick={() => markConversationRead(c)} className="text-xs text-slate-500 hover:text-slate-700 shrink-0">
                Mark read
              </button>
            </div>
          ))}
        </div>
      </details>

      <details open className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <summary className="px-4 py-3 cursor-pointer text-sm font-semibold text-slate-700 flex items-center justify-between">
          Reminders
          <span className="text-xs font-normal text-slate-500">{reminders.length}</span>
        </summary>
        <div className="border-t border-slate-100 divide-y divide-slate-100">
          {reminders.length === 0 ? (
            <p className="px-4 py-6 text-sm text-slate-500 text-center">Nothing upcoming.</p>
          ) : reminders.map((r) => (
            <Link key={r.id} href={r.href} className="block px-4 py-3 hover:bg-slate-50">
              <p className="text-sm font-medium text-slate-800">{r.title}</p>
              <p className="text-xs text-slate-500 mt-0.5">{r.subtitle}</p>
              {r.dueDate && <p className="text-xs text-amber-600 mt-1">Due {new Date(r.dueDate).toLocaleDateString('en-KE', { day: 'numeric', month: 'short' })}</p>}
            </Link>
          ))}
        </div>
      </details>
    </div>
  );
}
