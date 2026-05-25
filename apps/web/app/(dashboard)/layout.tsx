import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import DashboardShell from './DashboardShell';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  const { data: userRow } = await supabase
    .from('users')
    .select('full_name, role')
    .eq('auth_id', user.id)
    .maybeSingle();

  const displayName = userRow?.full_name ?? user.email ?? 'User';
  const role = userRow?.role as string | undefined;

  return (
    <DashboardShell role={role ?? ''} displayName={displayName}>
      {children}
    </DashboardShell>
  );
}
