import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { SupabaseService } from '../supabase/supabase.service';
import { PaymentsService } from './payments.service';

const TOLERANCE_KES = 1;

type PaybillTxn = {
  id: string;
  school_id: string;
  amount: number;
  bill_reference_number: string;
  msisdn: string;
  reconciliation_status: string;
};

/**
 * Matches an incoming Paybill payment (already persisted by
 * MpesaDarajaService) to a student and credits their fee balance.
 *
 * Attribution order matters: the transaction's school_id is resolved from
 * the callback's BusinessShortCode *before* this service ever runs (per-
 * school shortcodes, confirmed with the project owner) — admission-number
 * matching below only ever searches within that already-attributed school.
 * students.admission_no is only unique per school
 * (students_school_id_admission_no_key), never globally, so an unscoped
 * lookup would risk crediting the wrong school's student.
 */
@Injectable()
export class PaybillReconciliationService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly payments: PaymentsService,
  ) {}

  async reconcile(transactionId: string): Promise<void> {
    const { data: txn } = await this.supabase.admin
      .from('payment_paybill_transactions')
      .select('id, school_id, amount, bill_reference_number, msisdn, reconciliation_status')
      .eq('id', transactionId)
      .maybeSingle();

    // Idempotent: only ever reconciles a transaction still PENDING. A retried
    // confirmation callback that somehow re-triggers this is a no-op.
    if (!txn || txn.reconciliation_status !== 'PENDING') return;

    if (!txn.school_id) {
      await this.markUnmatched(txn as PaybillTxn, 'No school is registered for this Paybill shortcode');
      return;
    }

    const admissionRef = txn.bill_reference_number.trim().toUpperCase();
    const { data: students } = await this.supabase.admin
      .from('students')
      .select('id, admission_no, user:users!user_id(full_name)')
      .eq('school_id', txn.school_id);

    const exactMatches = (students ?? []).filter((s) => s.admission_no.trim().toUpperCase() === admissionRef);

    if (exactMatches.length === 1) {
      await this.matchToStudent(txn as PaybillTxn, exactMatches[0]!.id, 'MATCHED', null);
      return;
    }
    if (exactMatches.length > 1) {
      // Shouldn't happen — admission_no is school-scoped unique — but fail
      // safe rather than guess which one.
      await this.markUnmatched(txn as PaybillTxn, 'Ambiguous: more than one student matched this reference');
      return;
    }

    const suggestion = await this.suggestFuzzyMatch(txn.amount, txn.msisdn, (students ?? []).map((s) => s.id));
    if (suggestion) {
      // Suggest-only — never auto-applied. Status stays PENDING; an admin
      // must explicitly confirm via the manual-match action.
      await this.supabase.admin.from('payment_paybill_transactions').update({
        reconciliation_notes: `Suggested match: ${suggestion.studentName} (admission ${suggestion.admissionNo}) — phone matches a guardian, amount close to their outstanding balance. Admin confirmation required.`,
        updated_at: new Date().toISOString(),
      }).eq('id', txn.id);
      return;
    }

    await this.markUnmatched(txn as PaybillTxn, 'No admission-number or fuzzy match found');
  }

  private async matchToStudent(
    txn: PaybillTxn,
    studentId: string,
    status: 'MATCHED' | 'MANUALLY_MATCHED',
    matchedByUserId: string | null,
    explicitFeeBalanceId?: string,
  ): Promise<void> {
    const { data: balances } = await this.supabase.admin
      .from('fee_balances')
      .select('id, amount_due, amount_paid')
      .eq('student_id', studentId);

    const withOutstanding = (balances ?? [])
      .map((b) => ({ id: b.id as string, outstanding: Number(b.amount_due) - Number(b.amount_paid) }));

    let primary: { id: string; outstanding: number };
    let totalOutstanding: number;

    // An admin doing a manual match may pick a specific fee balance to credit
    // (e.g. this term's bill) rather than accept the auto-picked
    // highest-outstanding one — in that case the overpayment/partial wording
    // below is relative to that one bill, since that's what the admin
    // intentionally directed this payment against.
    if (explicitFeeBalanceId) {
      const picked = withOutstanding.find((b) => b.id === explicitFeeBalanceId);
      if (!picked) {
        await this.markUnmatched(txn, 'Selected fee balance does not belong to this student');
        return;
      }
      primary = picked;
      totalOutstanding = picked.outstanding;
    } else {
      const outstanding = withOutstanding
        .filter((b) => b.outstanding > 0)
        .sort((a, b) => b.outstanding - a.outstanding);

      if (outstanding.length === 0) {
        await this.markUnmatched(txn, 'Student matched, but has no outstanding fee balance to credit — needs manual balance selection');
        return;
      }

      primary = outstanding[0]!;
      totalOutstanding = outstanding.reduce((s, b) => s + b.outstanding, 0);
    }

    const diff = txn.amount - totalOutstanding;

    let notes: string | null = null;
    if (diff > TOLERANCE_KES) {
      notes = `Overpayment: KES ${txn.amount.toLocaleString()} received, KES ${totalOutstanding.toFixed(2)} outstanding`;
    } else if (diff < -TOLERANCE_KES) {
      notes = `Partial payment: KES ${txn.amount.toLocaleString()} of KES ${totalOutstanding.toFixed(2)} outstanding`;
    }
    // within tolerance either way: no note, a clean match

    await this.payments.creditFeeBalance(primary.id, txn.amount);

    await this.supabase.admin.from('payment_paybill_transactions').update({
      reconciliation_status: status,
      matched_student_id: studentId,
      matched_fee_balance_id: primary.id,
      matched_at: new Date().toISOString(),
      matched_by_user_id: matchedByUserId,
      reconciliation_notes: notes,
      updated_at: new Date().toISOString(),
    }).eq('id', txn.id);

    await this.auditTransition(txn.school_id, matchedByUserId, txn.id, status, { studentId, feeBalanceId: primary.id, notes });

    const { data: guardians } = await this.supabase.admin.from('guardians').select('user_id').eq('student_id', studentId);
    for (const g of guardians ?? []) {
      await this.payments.queuePaymentReceiptNotifications({
        schoolId: txn.school_id,
        recipientId: g.user_id,
        paymentId: txn.id,
        paymentType: 'paybill',
        amount: txn.amount,
        studentId,
      });
    }
  }

  private async markUnmatched(txn: PaybillTxn, reason: string): Promise<void> {
    await this.supabase.admin.from('payment_paybill_transactions').update({
      reconciliation_status: 'UNMATCHED',
      reconciliation_notes: reason,
      updated_at: new Date().toISOString(),
    }).eq('id', txn.id);
    await this.auditTransition(txn.school_id, null, txn.id, 'UNMATCHED', { reason });
  }

  /**
   * Phone-and-amount fallback, suggest-only. Normalizes both sides to the
   * last 9 digits (Kenyan MSISDN, ignoring +254/254/0 prefix variance).
   * `studentIds` (the school's own students, already fetched by the caller)
   * scopes the guardians lookup to this school — `guardians` itself has no
   * school_id column, only student_id, so this is the only way to keep a
   * fuzzy match from ever crossing schools.
   */
  private async suggestFuzzyMatch(amount: number, msisdn: string, studentIds: string[]): Promise<{ studentId: string; studentName: string; admissionNo: string } | null> {
    const normalizedMsisdn = msisdn.replace(/\D/g, '').slice(-9);
    if (normalizedMsisdn.length < 9 || studentIds.length === 0) return null;

    const { data: guardianLinks } = await this.supabase.admin
      .from('guardians')
      .select('student_id, user:users!user_id(phone)')
      .in('student_id', studentIds)
      .not('user.phone', 'is', null);

    const candidateStudentIds = new Set(
      (guardianLinks ?? [])
        .filter((g) => {
          const phone = (g.user as unknown as { phone: string | null })?.phone;
          return phone && phone.replace(/\D/g, '').slice(-9) === normalizedMsisdn;
        })
        .map((g) => g.student_id as string),
    );
    if (candidateStudentIds.size === 0) return null;

    for (const studentId of candidateStudentIds) {
      const { data: balances } = await this.supabase.admin.from('fee_balances').select('amount_due, amount_paid').eq('student_id', studentId);
      const totalOutstanding = (balances ?? []).reduce((s, b) => s + (Number(b.amount_due) - Number(b.amount_paid)), 0);
      if (Math.abs(totalOutstanding - amount) <= TOLERANCE_KES) {
        const { data: student } = await this.supabase.admin
          .from('students').select('admission_no, user:users!user_id(full_name)').eq('id', studentId).maybeSingle();
        if (!student) continue;
        return {
          studentId,
          studentName: (student.user as unknown as { full_name: string })?.full_name ?? 'Unknown',
          admissionNo: student.admission_no,
        };
      }
    }
    return null;
  }

  /**
   * Admin-invoked manual match — the confirmation step for a fuzzy
   * suggestion, or a from-scratch match for a genuinely UNMATCHED
   * transaction. requireAdmin + RLS-scoped reads throughout so a School A
   * admin can never match a School A transaction to a School B student
   * (the RLS-scoped student lookup for a cross-school id simply returns
   * nothing, same "doesn't resolve" pattern used elsewhere in this codebase).
   */
  async manualMatch(accessToken: string, transactionId: string, studentId: string, note: string | undefined, feeBalanceId?: string): Promise<void> {
    const me = await this.supabase.currentUserRow(accessToken, 'id, role, school_id') as { id: string; role: string; school_id: string } | null;
    if (!me || me.role !== 'ADMIN') throw new ForbiddenException('Admin role required');

    const client = this.supabase.forUser(accessToken);
    const { data: txn } = await client
      .from('payment_paybill_transactions')
      .select('id, school_id, amount, reconciliation_status')
      .eq('id', transactionId)
      .maybeSingle();
    if (!txn) throw new NotFoundException('Transaction not found');
    if (txn.reconciliation_status === 'MATCHED' || txn.reconciliation_status === 'MANUALLY_MATCHED') {
      throw new ForbiddenException('This transaction has already been matched');
    }

    // RLS-scoped — a student id belonging to a different school simply
    // won't resolve here, closing the cross-school match risk at the data
    // layer, not just the app layer.
    const { data: student } = await client.from('students').select('id').eq('id', studentId).maybeSingle();
    if (!student) throw new NotFoundException('Student not found');

    if (feeBalanceId) {
      // Same RLS-scoped-resolution guard as the student lookup above — a
      // fee balance belonging to a different school/student won't resolve.
      const { data: balance } = await client.from('fee_balances').select('id').eq('id', feeBalanceId).eq('student_id', studentId).maybeSingle();
      if (!balance) throw new NotFoundException('Fee balance not found for this student');
    }

    await this.matchToStudent(
      { id: txn.id, school_id: txn.school_id, amount: txn.amount, bill_reference_number: '', msisdn: '', reconciliation_status: txn.reconciliation_status },
      studentId,
      'MANUALLY_MATCHED',
      me.id,
      feeBalanceId,
    );

    if (note) {
      // Append rather than overwrite — matchToStudent may have just set an
      // auto-detected overpayment/partial-payment note worth keeping.
      const { data: updated } = await this.supabase.admin
        .from('payment_paybill_transactions').select('reconciliation_notes').eq('id', transactionId).single();
      const combinedNotes = [updated?.reconciliation_notes, `Admin note: ${note}`].filter(Boolean).join(' — ');
      await this.supabase.admin.from('payment_paybill_transactions')
        .update({ reconciliation_notes: combinedNotes, updated_at: new Date().toISOString() })
        .eq('id', transactionId);
    }
  }

  /** Task 5.1 — the admin's unmatched-transaction review queue. RLS-scoped via forUser, so already school-isolated. */
  async listUnmatched(accessToken: string) {
    const { data, error } = await this.supabase.forUser(accessToken)
      .from('payment_paybill_transactions')
      .select('id, mpesa_receipt_number, msisdn, amount, currency, bill_reference_number, reconciliation_notes, created_at')
      .eq('reconciliation_status', 'UNMATCHED')
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  /** Task 5.3 — MATCHED/MANUALLY_MATCHED transactions flagged as an overpayment (reconciliation_notes starts with "Overpayment:"). */
  async listOverpayments(accessToken: string) {
    const { data, error } = await this.supabase.forUser(accessToken)
      .from('payment_paybill_transactions')
      .select('id, mpesa_receipt_number, amount, currency, reconciliation_notes, matched_student:students!matched_student_id(admission_no, user:users!user_id(full_name)), created_at')
      .in('reconciliation_status', ['MATCHED', 'MANUALLY_MATCHED'])
      .ilike('reconciliation_notes', 'Overpayment:%')
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  /** Admin resolves an overpayment — records how it was handled (credit next term / refund issued), doesn't itself move money. */
  async resolveOverpayment(accessToken: string, transactionId: string, resolution: string): Promise<void> {
    const me = await this.supabase.currentUserRow(accessToken, 'id, role') as { id: string; role: string } | null;
    if (!me || me.role !== 'ADMIN') throw new ForbiddenException('Admin role required');

    const client = this.supabase.forUser(accessToken);
    const { data: txn } = await client.from('payment_paybill_transactions').select('id, reconciliation_notes').eq('id', transactionId).maybeSingle();
    if (!txn) throw new NotFoundException('Transaction not found');

    await this.supabase.admin.from('payment_paybill_transactions').update({
      reconciliation_notes: `${txn.reconciliation_notes} — Resolved: ${resolution}`,
      updated_at: new Date().toISOString(),
    }).eq('id', transactionId);
  }

  private async auditTransition(schoolId: string, userId: string | null, transactionId: string, newStatus: string, metadata: unknown): Promise<void> {
    await this.supabase.admin.from('audit_logs').insert({
      id: randomUUID(),
      school_id: schoolId,
      user_id: userId,
      action: 'payment_paybill.reconciliation_transition',
      entity_type: 'payment_paybill_transaction',
      entity_id: transactionId,
      metadata: { newStatus, ...(metadata as Record<string, unknown>) },
    });
  }
}
