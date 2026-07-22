import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import SuperAdminShell from './SuperAdminShell';

export default async function SuperAdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  const { data: userRow } = await supabase
    .from('users')
    .select('full_name, role, avatar_url')
    .eq('auth_id', user.id)
    .maybeSingle();

  if (userRow?.role !== 'SUPER_ADMIN') redirect('/login');

  const displayName = userRow?.full_name ?? user.email ?? 'Super Admin';

  return (
    <SuperAdminShell displayName={displayName} avatarUrl={userRow?.avatar_url ?? null}>
      {children}
    </SuperAdminShell>
  );
}
