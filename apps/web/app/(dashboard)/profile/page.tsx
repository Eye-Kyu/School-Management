import { createClient } from '@/lib/supabase/server';
import ProfileClient from './ProfileClient';

export default async function ProfilePage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: userRow } = await supabase
    .from('users')
    .select('full_name, email, phone, role, avatar_url')
    .eq('auth_id', user.id)
    .maybeSingle();

  return (
    <div className="space-y-6 max-w-lg">
      <div>
        <h1 className="text-2xl font-semibold">My profile</h1>
        <p className="text-sm text-slate-500 mt-1">Update your name, phone number, or password.</p>
      </div>
      <ProfileClient
        fullName={userRow?.full_name ?? ''}
        email={userRow?.email ?? user.email ?? ''}
        phone={userRow?.phone ?? ''}
        role={userRow?.role ?? ''}
        avatarUrl={userRow?.avatar_url ?? null}
      />
    </div>
  );
}
