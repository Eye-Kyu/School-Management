'use client';

import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { apiFetch } from '@/lib/api';
import posthog from 'posthog-js';

export default function LogoutButton() {
  const router = useRouter();
  const supabase = createClient();

  async function handleLogout() {
    apiFetch('/auth/events', { method: 'POST', body: JSON.stringify({ action: 'auth.logout' }) }).catch(() => {});
    posthog.capture('user_signed_out');
    posthog.reset();
    // SA-12: drop any assist-mode cookie so it cannot outlive this session.
    await fetch('/api/assist-mode/exit', { method: 'POST' }).catch(() => {});
    await supabase.auth.signOut();
    router.refresh();
    router.push('/login');
  }

  return (
    <button
      onClick={handleLogout}
      className="text-sm text-slate-500 hover:text-slate-900 transition-colors"
    >
      Sign out
    </button>
  );
}
