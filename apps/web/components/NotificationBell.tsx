'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { apiFetch } from '@/lib/api';

export default function NotificationBell() {
  const [count, setCount] = useState(0);
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    apiFetch<{ count: number }>('/notifications/unread-count')
      .then((res) => setCount(res.count))
      .catch(() => {});
  }, [pathname]);

  return (
    <button
      onClick={() => router.push('/notifications')}
      className="relative p-1.5 rounded-md text-slate-500 hover:bg-slate-100 transition-colors"
      aria-label={`Notifications${count > 0 ? ` (${count} unread)` : ''}`}
    >
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
        />
      </svg>
      {count > 0 && (
        <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white leading-none">
          {count > 9 ? '9+' : count}
        </span>
      )}
    </button>
  );
}
