import { Injectable, ForbiddenException, BadRequestException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { SupabaseService } from '../supabase/supabase.service';
import { FeeBalanceCsvRow } from '@school-manager/types';

@Injectable()
export class FeesService {
  constructor(private readonly supabase: SupabaseService) {}

  async list(accessToken: string) {
    const client = this.supabase.forUser(accessToken);
    const { data, error } = await client
      .from('fee_balances')
      .select(`
        id, amount_due, amount_paid, currency, notes, as_of_date, created_at,
        student:students!inner(id, admission_no, user:users!inner(full_name)),
        term:terms(id, name)
      `)
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async importCsv(accessToken: string, authUserId: string, csvText: string) {
    const client = this.supabase.forUser(accessToken);
    await this.requireAdmin(client);

    const { data: school } = await client.from('schools').select('id').single();
    if (!school) throw new ForbiddenException('No school found');

    const { data: userRow } = await client
      .from('users')
      .select('id')
      .eq('auth_id', authUserId)
      .maybeSingle();

    const lines = csvText.trim().split('\n').filter(Boolean);
    if (lines.length < 2) throw new BadRequestException('CSV must have a header row and at least one data row');

    // lines.length >= 2 asserted above, so index 0 is safe
    const headerLine = lines[0] as string;
    const header = headerLine.replace(/^\ufeff/, '').split(',').map((h) => h.trim().toLowerCase());
    for (const h of ['admissionno', 'amountdue']) {
      if (!header.includes(h)) {
        throw new BadRequestException(`Missing required column: ${h}`);
      }
    }

    const errors: string[] = [];
    const upserts: Array<{ row: number; result: 'ok' | 'error'; message?: string }> = [];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i] as string;
      const values = line.split(',').map((v) => v.trim());
      const raw: Record<string, string> = {};
      header.forEach((h, idx) => { raw[h] = values[idx] ?? ''; });

      const parsed = FeeBalanceCsvRow.safeParse({
        admissionNo: raw.admissionno,
        amountDue: raw.amountdue,
        amountPaid: raw.amountpaid || '0',
        termName: raw.termname || undefined,
        notes: raw.notes || undefined,
      });

      if (!parsed.success) {
        errors.push(`Row ${i + 1}: ${parsed.error.issues[0]?.message}`);
        upserts.push({ row: i + 1, result: 'error', message: parsed.error.issues[0]?.message });
        continue;
      }

      // Look up student by admission_no
      const { data: student } = await this.supabase.admin
        .from('students')
        .select('id')
        .eq('school_id', school.id)
        .eq('admission_no', parsed.data.admissionNo)
        .maybeSingle();

      if (!student) {
        const msg = `Student not found: ${parsed.data.admissionNo}`;
        errors.push(`Row ${i + 1}: ${msg}`);
        upserts.push({ row: i + 1, result: 'error', message: msg });
        continue;
      }

      // Optionally resolve term
      let termId: string | null = null;
      if (parsed.data.termName) {
        const { data: term } = await this.supabase.admin
          .from('terms')
          .select('id')
          .eq('school_id', school.id)
          .eq('name', parsed.data.termName)
          .maybeSingle();
        termId = term?.id ?? null;
      }

      const now = new Date().toISOString();
      const { error: upsertErr } = await this.supabase.admin
        .from('fee_balances')
        .insert({
          id: randomUUID(),
          school_id: school.id,
          student_id: student.id,
          term_id: termId,
          amount_due: parsed.data.amountDue,
          amount_paid: parsed.data.amountPaid,
          currency: 'KES',
          notes: parsed.data.notes ?? null,
          as_of_date: now.slice(0, 10),
          updated_at: now,
        });

      if (upsertErr) {
        errors.push(`Row ${i + 1}: ${upsertErr.message}`);
        upserts.push({ row: i + 1, result: 'error', message: upsertErr.message });
      } else {
        upserts.push({ row: i + 1, result: 'ok' });
      }
    }

    // Audit log for the import
    await client.from('audit_logs').insert({
      id: randomUUID(),
      school_id: school.id,
      user_id: userRow?.id ?? null,
      action: 'fees.import_csv',
      entity_type: 'fee_balance',
      entity_id: school.id,
      metadata: { total: lines.length - 1, ok: upserts.filter((u) => u.result === 'ok').length, errors },
    });

    return {
      imported: upserts.filter((u) => u.result === 'ok').length,
      failed: upserts.filter((u) => u.result === 'error').length,
      rows: upserts,
    };
  }

  private async requireAdmin(client: ReturnType<SupabaseService['forUser']>) {
    const { data } = await client.from('users').select('role').maybeSingle();
    if (data?.role !== 'ADMIN') throw new ForbiddenException('Admin role required');
  }
}
