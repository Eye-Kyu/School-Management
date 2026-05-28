import { createClient } from '@/lib/supabase/server';
import BackButton from '@/components/BackButton';
import ComplianceClient from './ComplianceClient';

export default async function CompliancePage() {
  const supabase = createClient();

  const [{ data: deletionRequests }, { data: apiTokens }] = await Promise.all([
    supabase
      .from('deletion_requests')
      .select('id, status, reason, created_at, target_user_id, requester:users!requested_by_id(full_name), target:users!target_user_id(full_name, email)')
      .order('created_at', { ascending: false }),
    supabase
      .from('api_tokens')
      .select('id, name, scopes, last_used_at, expires_at, created_at')
      .order('created_at', { ascending: false }),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <BackButton href="/admin" />
        <div>
          <h1 className="text-2xl font-semibold">Compliance &amp; API</h1>
          <p className="text-sm text-slate-500 mt-0.5">Data deletion requests and API token management.</p>
        </div>
      </div>
      <ComplianceClient
        deletionRequests={(deletionRequests ?? []) as any[]}
        apiTokens={(apiTokens ?? []) as any[]}
      />
    </div>
  );
}
