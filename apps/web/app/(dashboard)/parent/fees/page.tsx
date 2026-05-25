import { createClient } from '@/lib/supabase/server';
import BackButton from '@/components/BackButton';
import ParentFeesClient from './ParentFeesClient';

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

  const studentMap = Object.fromEntries(students.map((s: any) => [s.id, s]));

  const totalDue = (balances ?? []).reduce((s, b) => s + Number((b as any).amount_due), 0);
  const totalPaid = (balances ?? []).reduce((s, b) => s + Number((b as any).amount_paid), 0);
  const currency = (balances as any[])?.[0]?.currency ?? 'KES';

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <BackButton href="/parent" />
        <div>
          <h1 className="text-2xl font-semibold">Fee balances</h1>
          <p className="text-sm text-slate-500 mt-0.5">Outstanding school fees for your children.</p>
        </div>
      </div>

      <ParentFeesClient
        balances={(balances ?? []) as any[]}
        studentMap={studentMap as any}
        totalDue={totalDue}
        totalPaid={totalPaid}
        currency={currency}
      />
    </div>
  );
}
