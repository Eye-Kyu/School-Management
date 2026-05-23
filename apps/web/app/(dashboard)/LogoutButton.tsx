'use client';

import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export default function LogoutButton() {
  const router = useRouter();
  const supabase = createClient();

  async function handleLogout() {
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
