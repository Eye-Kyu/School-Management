import { createClient } from '@/lib/supabase/server';
import { getMyRoleBadges } from '@/lib/roleBadges';
import RoleBadgeList from '@/components/RoleBadgeList';
import ProfileClient from './ProfileClient';

export default async function ProfilePage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: userRow } = await supabase
    .from('users')
    .select('id, full_name, email, phone, role, avatar_url')
    .eq('auth_id', user.id)
    .maybeSingle();

  const { data: prefs } = await supabase
    .from('notification_preferences')
    .select('notification_type, email_enabled, sms_enabled');

  const badges = userRow ? await getMyRoleBadges(supabase, userRow.id, userRow.role) : [];

  return (
    <div className="space-y-6 max-w-lg">
      <div>
        <h1 className="text-2xl font-semibold">My profile</h1>
        <p className="text-sm text-slate-500 mt-1">Update your name, phone number, password, or notification preferences.</p>
        {badges.length > 0 && <RoleBadgeList badges={badges} className="mt-3" />}
      </div>
      <ProfileClient
        fullName={userRow?.full_name ?? ''}
        email={userRow?.email ?? user.email ?? ''}
        phone={userRow?.phone ?? ''}
        role={userRow?.role ?? ''}
        avatarUrl={userRow?.avatar_url ?? null}
        notifPrefs={(prefs ?? []) as { notification_type: string; email_enabled: boolean; sms_enabled: boolean }[]}
      />
    </div>
  );
}
