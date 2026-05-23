import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import LogoutButton from './LogoutButton';

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
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200 px-6 py-3">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-lg font-semibold">School Manager</span>
            {role && (
              <span className="text-xs font-medium uppercase tracking-wide
                               bg-slate-100 text-slate-600 px-2 py-0.5 rounded">
                {role.toLowerCase()}
              </span>
            )}
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-slate-600 hidden sm:block">{displayName}</span>
            <LogoutButton />
          </div>
        </div>
      </header>
      <main className="max-w-7xl mx-auto p-6">{children}</main>
    </div>
  );
}
