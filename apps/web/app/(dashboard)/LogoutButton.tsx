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
