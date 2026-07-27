import { createClient } from '@/lib/supabase/server';
import BackButton from '@/components/BackButton';
import Link from 'next/link';
import PaybillDashboard from './PaybillDashboard';

function fmt(n: number) { return `KES ${n.toLocaleString()}`; }

export default async function AdminPaymentsPage({ searchParams }: { searchParams: { filter?: string } }) {
  const supabase = createClient();
  const filter = searchParams.filter ?? 'all';

  const { data: all } = await supabase
    .from('payment_transactions')
    .select('id, reference, amount, currency, status, created_at, student:students!student_id(user:users!user_id(full_name), admission_no), parent:users!parent_user_id(full_name)')
    .order('created_at', { ascending: false })
    .limit(200);

  const rows = all ?? [];
  const today = new Date().toDateString();
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();

  const stats = {
    totalCollected: rows.filter((r) => r.status === 'SUCCESS').reduce((s, r) => s + r.amount, 0),
    today: rows.filter((r) => r.status === 'SUCCESS' && new Date(r.created_at).toDateString() === today).reduce((s, r) => s + r.amount, 0),
    thisWeek: rows.filter((r) => r.status === 'SUCCESS' && r.created_at >= weekAgo).reduce((s, r) => s + r.amount, 0),
    failed: rows.filter((r) => r.status === 'FAILED').length,
    pending: rows.filter((r) => r.status === 'PENDING').length,
  };

  const filtered = filter === 'failed' ? rows.filter((r) => r.status === 'FAILED')
    : filter === 'pending' ? rows.filter((r) => r.status === 'PENDING')
    : filter === 'today' ? rows.filter((r) => new Date(r.created_at).toDateString() === today)
    : rows;

  const STATUS_STYLE: Record<string, string> = {
    SUCCESS: 'bg-emerald-100 text-emerald-700',
    FAILED: 'bg-rose-100 text-rose-700',
    PENDING: 'bg-amber-100 text-amber-700',
    ABANDONED: 'bg-slate-100 text-slate-500',
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <BackButton href="/admin" />
        <div>
          <h1 className="text-2xl font-semibold">Fee payments</h1>
          <p className="text-sm text-slate-500 mt-0.5">Online payment reconciliation dashboard.</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-100 rounded-xl px-5 py-4">
          <p className="text-xs text-slate-400 uppercase tracking-wide font-medium">Total collected</p>
          <p className="text-2xl font-bold text-emerald-700 mt-1">{fmt(stats.totalCollected)}</p>
        </div>
        <div className="bg-white border border-slate-100 rounded-xl px-5 py-4">
          <p className="text-xs text-slate-400 uppercase tracking-wide font-medium">Today</p>
          <p className="text-2xl font-bold text-slate-800 mt-1">{fmt(stats.today)}</p>
        </div>
        <div className="bg-white border border-slate-100 rounded-xl px-5 py-4">
          <p className="text-xs text-slate-400 uppercase tracking-wide font-medium">This week</p>
          <p className="text-2xl font-bold text-slate-800 mt-1">{fmt(stats.thisWeek)}</p>
        </div>
        <div className="bg-white border border-slate-100 rounded-xl px-5 py-4">
          <p className="text-xs text-slate-400 uppercase tracking-wide font-medium">Failed / Pending</p>
          <p className="text-2xl font-bold text-rose-600 mt-1">{stats.failed} / {stats.pending}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        {[['all', 'All'], ['today', 'Today'], ['pending', 'Pending'], ['failed', 'Failed']].map(([val, label]) => (
          <a key={val} href={`/admin/payments${val !== 'all' ? `?filter=${val}` : ''}`}
            className={`text-sm px-3 py-1 rounded-full font-medium transition-colors ${filter === val ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
            {label}
          </a>
        ))}
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-white p-10 text-center text-sm text-slate-400">No payments found.</div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Student</th>
                <th className="px-4 py-2 text-left font-medium">Parent</th>
                <th className="px-4 py-2 text-right font-medium">Amount</th>
                <th className="px-4 py-2 text-center font-medium">Status</th>
                <th className="px-4 py-2 text-right font-medium">Date</th>
                <th className="px-4 py-2 text-center font-medium">Receipt</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => (
                <tr key={r.id} className={`border-t border-slate-100 ${i % 2 ? 'bg-slate-50/40' : ''}`}>
                  <td className="px-4 py-2.5">
                    <p className="font-medium text-slate-800">{((r.student as any)?.user as any)?.full_name ?? '—'}</p>
                    <p className="text-xs text-slate-400">{(r.student as any)?.admission_no}</p>
                  </td>
                  <td className="px-4 py-2.5 text-slate-600">{(r.parent as any)?.full_name ?? '—'}</td>
                  <td className="px-4 py-2.5 text-right font-semibold text-slate-800">{r.currency} {Number(r.amount).toLocaleString()}</td>
                  <td className="px-4 py-2.5 text-center">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${STATUS_STYLE[r.status] ?? 'bg-slate-100 text-slate-500'}`}>{r.status}</span>
                  </td>
                  <td className="px-4 py-2.5 text-right text-xs text-slate-400">
                    {new Date(r.created_at).toLocaleString('en-KE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true })}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    {r.status === 'SUCCESS' && (
                      <Link href={`/print/receipt/${r.id}`} target="_blank" className="text-xs text-blue-600 hover:underline">View</Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <hr className="border-slate-200" />

      <PaybillDashboard />
    </div>
  );
}
