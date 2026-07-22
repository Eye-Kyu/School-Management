'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import StatCard from '../../StatCard';

type OverdueInvoice = { id: string; schoolId: string | null; schoolName: string; amount: number; currency: string; dueDate: string };

type BillingOverview = {
  outstandingByCurrency: Record<string, number>;
  collectedThisMonthByCurrency: Record<string, number>;
  overdueInvoices: OverdueInvoice[];
};

function daysOverdue(dueDate: string): number {
  const ms = Date.now() - new Date(dueDate).getTime();
  return Math.max(0, Math.floor(ms / (24 * 60 * 60 * 1000)));
}

export default function BillingPage() {
  const [overview, setOverview] = useState<BillingOverview | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    apiFetch<BillingOverview>('/super-admin/billing/overview')
      .then(setOverview)
      .catch((e) => setErr(e instanceof Error ? e.message : 'Failed to load billing overview'));
  }, []);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Billing</h1>
        <p className="text-sm text-slate-500 mt-0.5">A manual invoice ledger against school subscriptions — every figure here traces back to a real invoice.</p>
      </div>

      {err && <p className="text-sm text-red-600">{err}</p>}

      {!overview ? (
        <p className="text-sm text-slate-400 text-center py-6">Loading…</p>
      ) : (
        <>
          <section>
            <h2 className="text-sm font-semibold text-slate-600 mb-3">Totals</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {Object.entries(overview.outstandingByCurrency).length === 0 ? (
                <StatCard label="Outstanding" value={0} />
              ) : (
                Object.entries(overview.outstandingByCurrency).map(([currency, amount]) => (
                  <StatCard key={`outstanding-${currency}`} label={`Outstanding (${currency})`} value={amount} accent="text-amber-600" />
                ))
              )}
              {Object.entries(overview.collectedThisMonthByCurrency).length === 0 ? (
                <StatCard label="Collected this month" value={0} />
              ) : (
                Object.entries(overview.collectedThisMonthByCurrency).map(([currency, amount]) => (
                  <StatCard key={`collected-${currency}`} label={`Collected this month (${currency})`} value={amount} accent="text-emerald-600" />
                ))
              )}
              <StatCard label="Overdue invoices" value={overview.overdueInvoices.length} accent="text-rose-600" />
            </div>
          </section>

          <section>
            <h2 className="text-sm font-semibold text-slate-600 mb-3">Overdue invoices</h2>
            {overview.overdueInvoices.length === 0 ? (
              <p className="text-sm text-slate-400 bg-white border border-dashed border-slate-200 rounded-xl px-5 py-6 text-center">
                No overdue invoices.
              </p>
            ) : (
              <div className="bg-white border border-slate-100 rounded-xl divide-y divide-slate-100">
                {overview.overdueInvoices.map((inv) => (
                  <Link
                    key={inv.id}
                    href={inv.schoolId ? `/super-admin/schools/${inv.schoolId}` : '#'}
                    className="flex items-center justify-between px-5 py-3 hover:bg-slate-50 transition-colors"
                  >
                    <div>
                      <p className="font-medium text-slate-800">{inv.schoolName}</p>
                      <p className="text-xs text-slate-400 mt-0.5">Due {new Date(inv.dueDate).toLocaleDateString()} · {daysOverdue(inv.dueDate)} days overdue</p>
                    </div>
                    <span className="text-sm font-semibold text-rose-600 shrink-0">{inv.currency} {inv.amount.toLocaleString()}</span>
                  </Link>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
