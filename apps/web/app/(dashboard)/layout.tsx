import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { createRealClient } from '@/lib/supabase/server';
import { ASSIST_MODE_COOKIE, verifyAssistTokenSync } from '@/lib/assistMode';
import DashboardShell from './DashboardShell';
import AssistModeBanner from './AssistModeBanner';
import PostHogIdentify from '@/components/PostHogIdentify';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  // Always the real caller's own session — identity/chrome must reflect the
  // real SuperAdmin, not the target school, even while assist mode swaps
  // page-content reads (see lib/supabase/server.ts's createClient()).
  const supabase = createRealClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  const { data: userRow } = await supabase
    .from('users')
    .select('full_name, role, avatar_url')
    .eq('auth_id', user.id)
    .maybeSingle();

  const displayName = userRow?.full_name ?? user.email ?? 'User';
  const role = userRow?.role as string | undefined;

  const assistToken = cookies().get(ASSIST_MODE_COOKIE)?.value;
  const assistClaims = role === 'SUPER_ADMIN' ? verifyAssistTokenSync(assistToken) : null;
  let assistSchoolName: string | null = null;
  if (assistClaims) {
    const { data: schoolRow } = await supabase.from('schools').select('name').eq('id', assistClaims.targetSchoolId).maybeSingle();
    assistSchoolName = schoolRow?.name ?? null;
  }

  return (
    <DashboardShell role={role ?? ''} displayName={displayName} avatarUrl={userRow?.avatar_url ?? null}>
      <PostHogIdentify />
      {assistClaims && (
        <AssistModeBanner
          schoolName={assistSchoolName ?? 'this school'}
          superAdminName={displayName}
          schoolId={assistClaims.targetSchoolId}
          accessGrantId={assistClaims.accessGrantId}
        />
      )}
      {children}
    </DashboardShell>
  );
}
