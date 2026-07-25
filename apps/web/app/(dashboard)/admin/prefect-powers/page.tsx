import BackButton from '@/components/BackButton';
import { createClient } from '@/lib/supabase/server';
import PrefectPowersClient from './PrefectPowersClient';

export default async function PrefectPowersPage() {
  const supabase = createClient();
  const { data: powers } = await supabase
    .from('prefect_powers')
    .select('id, power_code, applies_to, enabled, updated_at')
    .order('applies_to')
    .order('power_code');

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <BackButton href="/admin" />
        <div>
          <h1 className="text-2xl font-semibold">Prefect Powers</h1>
          <p className="text-sm text-slate-500 mt-0.5">Toggle what Class Prefects and School Prefects can do at this school.</p>
        </div>
      </div>
      <PrefectPowersClient initialPowers={powers ?? []} />
    </div>
  );
}
