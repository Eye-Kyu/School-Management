import { createClient } from '@/lib/supabase/server';
import BackButton from '@/components/BackButton';
import FeesClient from './FeesClient';

export default async function AdminFeesPage() {
  const supabase = createClient();

  const { data: balances } = await supabase
    .from('fee_balances')
    .select(`
      id, amount_due, amount_paid, currency, notes, as_of_date,
      student:students!inner(admission_no, user:users!inner(full_name)),
      term:terms(name)
    `)
    .order('created_at', { ascending: false });

  const totalDue = (balances ?? []).reduce((s, b) => s + Number((b as any).amount_due), 0);
  const totalPaid = (balances ?? []).reduce((s, b) => s + Number((b as any).amount_paid), 0);
  const totalOutstanding = totalDue - totalPaid;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <BackButton href="/admin" />
        <div>
          <h1 className="text-2xl font-semibold">Fee arrears</h1>
          <p className="text-sm text-slate-500 mt-0.5">Import and view student fee balances.</p>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className={`rounded-xl border p-5 ${totalOutstanding > 0 ? 'bg-amber-50 border-amber-200' : 'bg-emerald-50 border-emerald-200'}`}>
          <p className={`text-3xl font-bold ${totalOutstanding > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>
            KES {totalOutstanding.toLocaleString()}
          </p>
          <p className={`text-sm mt-1 ${totalOutstanding > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>Total outstanding</p>
        </div>
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-5">
          <p className="text-3xl font-bold text-slate-700">KES {totalDue.toLocaleString()}</p>
          <p className="text-sm text-slate-500 mt-1">Total billed</p>
        </div>
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-5">
          <p className="text-3xl font-bold text-emerald-700">KES {totalPaid.toLocaleString()}</p>
          <p className="text-sm text-emerald-600 mt-1">Total collected</p>
        </div>
      </div>

      <FeesClient balances={(balances ?? []) as any[]} />
    </div>
  );
}
