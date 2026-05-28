import { createClient } from '@/lib/supabase/server';
import BackButton from '@/components/BackButton';
import SafetyTipsClient from './SafetyTipsClient';

export default async function AdminSafetyTipsPage() {
  const supabase = createClient();
  const { data: tips } = await supabase
    .from('safety_tips')
    .select('id, message, status, created_at, reviewed_at')
    .order('created_at', { ascending: false });

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center gap-4">
        <BackButton href="/admin" />
        <div>
          <h1 className="text-2xl font-semibold">Safety tips</h1>
          <p className="text-sm text-slate-500 mt-0.5">Anonymous reports from students. Visible only to admin.</p>
        </div>
      </div>
      <SafetyTipsClient tips={(tips ?? []) as any[]} />
    </div>
  );
}
