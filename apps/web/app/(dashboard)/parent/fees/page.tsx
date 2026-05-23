import { createClient } from '@/lib/supabase/server';
import BackButton from '@/components/BackButton';

export default async function ParentFeesPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: userRow } = await supabase
    .from('users')
    .select('id, full_name')
    .eq('auth_id', user.id)
    .maybeSingle();

  const { data: guardianLinks } = userRow
    ? await supabase
        .from('guardians')
        .select('student:students!inner(id, admission_no, user:users!inner(full_name))')
        .eq('user_id', userRow.id)
    : { data: [] };

  const students = (guardianLinks ?? []).map((g: any) => g.student).filter(Boolean);
  const studentIds = students.map((s: any) => s.id);

  const { data: balances } = studentIds.length > 0
    ? await supabase
        .from('fee_balances')
        .select('id, student_id, amount_due, amount_paid, currency, notes, as_of_date, term:terms(name)')
        .in('student_id', studentIds)
        .order('created_at', { ascending: false })
    : { data: [] };

  const studentMap = Object.fromEntries(
    students.map((s: any) => [s.id, s]),
  );

  const totalDue = (balances ?? []).reduce((s, b) => s + Number((b as any).amount_due), 0);
  const totalPaid = (balances ?? []).reduce((s, b) => s + Number((b as any).amount_paid), 0);
  const totalOutstanding = totalDue - totalPaid;
  const currency = (balances as any[])?.[0]?.currency ?? 'KES';

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <BackButton href="/parent" />
        <div>
          <h1 className="text-2xl font-semibold">Fee balances</h1>
          <p className="text-sm text-slate-500 mt-0.5">Outstanding school fees</p>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className={`rounded-xl p-5 ${totalOutstanding > 0 ? 'bg-amber-50 border border-amber-200' : 'bg-emerald-50 border border-emerald-200'}`}>
          <p className={`text-3xl font-bold ${totalOutstanding > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>
            {currency} {totalOutstanding.toLocaleString()}
          </p>
          <p className={`text-sm mt-1 ${totalOutstanding > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
            {totalOutstanding > 0 ? 'Outstanding' : 'All paid'}
          </p>
        </div>
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-5">
          <p className="text-3xl font-bold text-slate-700">{currency} {totalDue.toLocaleString()}</p>
          <p className="text-sm text-slate-500 mt-1">Total billed</p>
        </div>
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-5">
          <p className="text-3xl font-bold text-emerald-700">{currency} {totalPaid.toLocaleString()}</p>
          <p className="text-sm text-emerald-600 mt-1">Total paid</p>
        </div>
      </div>

      {/* Balance records */}
      {(balances ?? []).length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl px-5 py-10 text-center text-sm text-slate-400">
          No fee records on file.
        </div>
      ) : (
        <div className="space-y-3">
          {(balances ?? []).map((b: any) => {
            const outstanding = Number(b.amount_due) - Number(b.amount_paid);
            const student = studentMap[b.student_id];
            return (
              <div key={b.id}
                className={`bg-white rounded-xl border shadow-sm overflow-hidden
                  ${outstanding > 0 ? 'border-amber-200' : 'border-emerald-200'}`}>
                <div className={`px-5 py-3 flex items-center justify-between
                  ${outstanding > 0 ? 'bg-amber-50' : 'bg-emerald-50'}`}>
                  <div>
                    <p className="font-semibold text-slate-800">{student?.user?.full_name}</p>
                    <p className="text-xs text-slate-500">{b.term?.name ?? 'General'}</p>
                  </div>
                  <p className={`text-lg font-bold ${outstanding > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>
                    {outstanding > 0 ? `${b.currency} ${outstanding.toLocaleString()} due` : 'Paid'}
                  </p>
                </div>
                <div className="px-5 py-3 grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-xs text-slate-400">Amount billed</p>
                    <p className="font-medium">{b.currency} {Number(b.amount_due).toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">Amount paid</p>
                    <p className="font-medium text-emerald-600">{b.currency} {Number(b.amount_paid).toLocaleString()}</p>
                  </div>
                  {b.notes && (
                    <div className="col-span-2">
                      <p className="text-xs text-slate-400">Note</p>
                      <p className="text-slate-600">{b.notes}</p>
                    </div>
                  )}
                </div>
                {/* Payment progress bar */}
                <div className="px-5 pb-3">
                  <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-emerald-500 rounded-full"
                      style={{ width: `${Math.min(100, (Number(b.amount_paid) / Number(b.amount_due)) * 100)}%` }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
