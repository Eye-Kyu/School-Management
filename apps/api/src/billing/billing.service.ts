import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { SupabaseService } from '../supabase/supabase.service';
import type { CreatePlatformInvoiceInput, UpdatePlatformInvoiceStatusInput } from '@school-manager/types';

const INVOICE_COLUMNS =
  'id, school_id, subscription_id, package_id, package_name, amount, currency, billing_cycle, period_start, period_end, due_date, status, paid_at, notes, created_at';

type PackageSnapshot = { id: string; name: string; price: number; currency: string; billing_cycle: 'MONTHLY' | 'ANNUAL' };

@Injectable()
export class BillingService {
  constructor(private readonly supabase: SupabaseService) {}

  private async resolveCaller(callerAuthId: string) {
    const { data } = await this.supabase.admin.from('users').select('id').eq('auth_id', callerAuthId).maybeSingle();
    return data;
  }

  /** Cheap bulk sweep — calendar-date granularity is all that matters here, so a single UPDATE beats a per-row lazy check. */
  private async sweepOverdue() {
    const today = new Date().toISOString().slice(0, 10);
    await this.supabase.admin
      .from('platform_invoices')
      .update({ status: 'OVERDUE', updated_at: new Date().toISOString() })
      .eq('status', 'PENDING')
      .lt('due_date', today);
  }

  async listSchoolInvoices(schoolId: string) {
    await this.sweepOverdue();
    const { data, error } = await this.supabase.admin
      .from('platform_invoices')
      .select(INVOICE_COLUMNS)
      .eq('school_id', schoolId)
      .order('created_at', { ascending: false });
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async createInvoice(schoolId: string, input: CreatePlatformInvoiceInput, callerAuthId: string) {
    const caller = await this.resolveCaller(callerAuthId);
    const { data: school } = await this.supabase.admin.from('schools').select('id').eq('id', schoolId).maybeSingle();
    if (!school) throw new NotFoundException('School not found');

    const { data: sub } = await this.supabase.admin
      .from('school_subscriptions')
      .select('id, package:packages(id, name, price, currency, billing_cycle)')
      .eq('school_id', schoolId)
      .eq('status', 'ACTIVE')
      .maybeSingle();
    if (!sub) throw new BadRequestException('School has no active subscription to invoice');
    const pkg = sub.package as unknown as PackageSnapshot;

    const now = new Date().toISOString();
    const { data, error } = await this.supabase.admin
      .from('platform_invoices')
      .insert({
        id: randomUUID(),
        school_id: schoolId,
        subscription_id: sub.id,
        package_id: pkg.id,
        package_name: pkg.name,
        amount: pkg.price,
        currency: pkg.currency,
        billing_cycle: pkg.billing_cycle,
        period_start: input.periodStart,
        period_end: input.periodEnd,
        due_date: input.dueDate,
        status: 'PENDING',
        notes: input.notes ?? null,
        updated_at: now,
      })
      .select(INVOICE_COLUMNS)
      .single();
    if (error) throw new BadRequestException(error.message);

    await this.supabase.admin.from('audit_logs').insert({
      id: randomUUID(),
      school_id: schoolId,
      user_id: caller?.id ?? null,
      action: 'billing.invoice_create',
      entity_type: 'platform_invoices',
      entity_id: data.id,
      metadata: { amount: pkg.price, currency: pkg.currency, package_name: pkg.name, period_start: input.periodStart, period_end: input.periodEnd, due_date: input.dueDate },
    });

    return data;
  }

  async updateInvoiceStatus(invoiceId: string, input: UpdatePlatformInvoiceStatusInput, callerAuthId: string) {
    const caller = await this.resolveCaller(callerAuthId);
    const { data: existing } = await this.supabase.admin
      .from('platform_invoices')
      .select('id, school_id, status')
      .eq('id', invoiceId)
      .maybeSingle();
    if (!existing) throw new NotFoundException('Invoice not found');
    if (!['PENDING', 'OVERDUE'].includes(existing.status)) {
      throw new BadRequestException(`Invoice is already ${existing.status} and cannot be changed further`);
    }

    const now = new Date().toISOString();
    const patch: Record<string, unknown> = { status: input.status, updated_at: now };
    if (input.notes !== undefined) patch.notes = input.notes;
    if (input.status === 'PAID') patch.paid_at = input.paidAt ?? now;

    const { data, error } = await this.supabase.admin
      .from('platform_invoices')
      .update(patch)
      .eq('id', invoiceId)
      .select(INVOICE_COLUMNS)
      .single();
    if (error) throw new BadRequestException(error.message);

    await this.supabase.admin.from('audit_logs').insert({
      id: randomUUID(),
      school_id: existing.school_id,
      user_id: caller?.id ?? null,
      action: input.status === 'PAID' ? 'billing.invoice_paid' : 'billing.invoice_cancel',
      entity_type: 'platform_invoices',
      entity_id: invoiceId,
      metadata: { notes: input.notes ?? null },
    });

    return data;
  }

  async getOverview() {
    await this.sweepOverdue();

    const [{ data: outstanding }, { data: collected }, { data: overdue }] = await Promise.all([
      this.supabase.admin.from('platform_invoices').select('amount, currency').in('status', ['PENDING', 'OVERDUE']),
      this.supabase.admin
        .from('platform_invoices')
        .select('amount, currency')
        .eq('status', 'PAID')
        .gte('paid_at', new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()),
      this.supabase.admin
        .from('platform_invoices')
        .select('id, amount, currency, due_date, school:schools(id, name)')
        .eq('status', 'OVERDUE')
        .order('due_date', { ascending: true }),
    ]);

    const groupByCurrency = (rows: { amount: number; currency: string }[] | null) => {
      const totals: Record<string, number> = {};
      for (const r of rows ?? []) totals[r.currency] = (totals[r.currency] ?? 0) + Number(r.amount);
      return totals;
    };

    return {
      outstandingByCurrency: groupByCurrency(outstanding),
      collectedThisMonthByCurrency: groupByCurrency(collected),
      overdueInvoices: (overdue ?? []).map((r) => {
        const school = r.school as unknown as { id: string; name: string } | { id: string; name: string }[] | null;
        const s = Array.isArray(school) ? school[0] : school;
        return {
          id: r.id,
          schoolId: s?.id ?? null,
          schoolName: s?.name ?? 'Unknown school',
          amount: r.amount,
          currency: r.currency,
          dueDate: r.due_date,
        };
      }),
    };
  }
}
