import BackButton from '@/components/BackButton';
import { createClient } from '@/lib/supabase/server';
import TermsClient from './TermsClient';

export default async function TermsPage() {
  const supabase = createClient();
  const { data: terms } = await supabase
    .from('terms')
    .select('id, name, start_date, end_date, is_current')
    .order('start_date', { ascending: false });

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <BackButton href="/admin" />
        <div>
          <h1 className="text-2xl font-semibold">Terms</h1>
          <p className="text-sm text-slate-500 mt-0.5">Manage academic terms</p>
        </div>
      </div>
      <TermsClient initialTerms={terms ?? []} />
    </div>
  );
}
