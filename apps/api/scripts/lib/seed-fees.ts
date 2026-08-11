// =============================================================================
// Fees: fee_balances, payment_records (manual), payment_transactions
// (Paystack), payment_paybill_transactions (M-Pesa reconciliation) — 4 real
// tables, not the task's originally-assumed single "fee_structure".
// =============================================================================

import { randomUUID } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { SeedLogger } from './seed-logger';
import { batchInsert } from './db-utils';
import type { SeededTerm, SeededStudent } from './types';
import type { DemoPatterns } from './demo-patterns';
import type { Rng } from './kenyan-names';

const TERM_FEE = 15000;

type Bucket = 'FULL' | 'PARTIAL' | 'UNPAID';

export async function seedFees(
  admin: SupabaseClient,
  logger: SeedLogger,
  schoolId: string,
  term: SeededTerm,
  students: SeededStudent[],
  adminUserId: string,
  demo: DemoPatterns,
  rng: Rng,
): Promise<void> {
  const feeBalanceRows: Array<{ id: string; school_id: string; student_id: string; term_id: string; amount_due: number; amount_paid: number; currency: string; updated_at: string }> = [];
  const paymentRecordRows: Array<{ id: string; school_id: string; fee_balance_id: string; student_id: string; amount: number; payment_method: string; reference_no: string; paid_date: string; recorded_by_id: string }> = [];
  const paystackRows: Array<{ id: string; school_id: string; student_id: string; parent_user_id: string; fee_balance_id: string; provider: string; reference: string; amount: number; status: string }> = [];
  const paybillRows: Array<{
    id: string; school_id: string; mpesa_receipt_number: string; transaction_type: string; transaction_time: string;
    amount: number; msisdn: string; bill_reference_number: string; business_shortcode: string;
    reconciliation_status: string; matched_student_id: string | null; matched_fee_balance_id: string | null;
    matched_at: string | null; matched_by_user_id: string | null; raw_callback: Record<string, unknown>;
  }> = [];

  let paystackRefCounter = 0;
  let mpesaReceiptCounter = 0;

  students.forEach((student) => {
    const feeBalanceId = randomUUID();
    let bucket: Bucket;
    if (student.studentId === demo.arrearsStudent.studentId) bucket = 'UNPAID';
    else if (student.studentId === demo.starStudent.studentId) bucket = 'FULL';
    else {
      const r = rng();
      bucket = r < 0.6 ? 'FULL' : r < 0.85 ? 'PARTIAL' : 'UNPAID';
    }

    const amountPaid = bucket === 'FULL' ? TERM_FEE : bucket === 'PARTIAL' ? Math.round(3000 + rng() * 9000) : 0;
    feeBalanceRows.push({ id: feeBalanceId, school_id: schoolId, student_id: student.studentId, term_id: term.id, amount_due: TERM_FEE, amount_paid: amountPaid, currency: 'KES', updated_at: new Date().toISOString() });

    if (amountPaid === 0) return; // UNPAID — no payment rows, matches the arrears demo case exactly

    const method = rng();
    const paidDate = '2026-05-20';
    if (method < 0.4) {
      paystackRows.push({
        id: randomUUID(), school_id: schoolId, student_id: student.studentId, parent_user_id: adminUserId,
        fee_balance_id: feeBalanceId, provider: 'PAYSTACK', reference: `SEED-PS-${String(paystackRefCounter++).padStart(4, '0')}`,
        amount: amountPaid, status: 'SUCCESS',
      });
    } else if (method < 0.75) {
      const receipt = `SEED-MP-${String(mpesaReceiptCounter++).padStart(6, '0')}`;
      paybillRows.push({
        id: randomUUID(), school_id: schoolId, mpesa_receipt_number: receipt, transaction_type: 'Pay Bill',
        transaction_time: `${paidDate}T09:00:00Z`, amount: amountPaid, msisdn: '254700000900',
        bill_reference_number: student.admissionNo, business_shortcode: '400200',
        reconciliation_status: 'MATCHED', matched_student_id: student.studentId, matched_fee_balance_id: feeBalanceId,
        matched_at: `${paidDate}T09:05:00Z`, matched_by_user_id: adminUserId, raw_callback: { seeded: true, receipt },
      });
    } else {
      paymentRecordRows.push({
        // 'cash' — payment_records_payment_method_check only allows lowercase
        // ('cash'|'bank_transfer'|'mpesa'|'cheque'|'other'), confirmed live
        // via pg_constraint (not documented in any tracked migration).
        id: randomUUID(), school_id: schoolId, fee_balance_id: feeBalanceId, student_id: student.studentId,
        amount: amountPaid, payment_method: 'cash', reference_no: `SEED-CASH-${randomUUID().slice(0, 8)}`,
        paid_date: paidDate, recorded_by_id: adminUserId,
      });
    }
  });

  // Demo case: one unmatched Paybill payment — school resolved via shortcode
  // (real M-Pesa callback behavior), but bill_reference_number doesn't match
  // any seeded student's admission number, so it's never auto-matched.
  paybillRows.push({
    id: randomUUID(), school_id: schoolId, mpesa_receipt_number: 'SEED-MP-UNMATCHED1', transaction_type: 'Pay Bill',
    transaction_time: '2026-06-02T11:15:00Z', amount: 5000, msisdn: '254700000999',
    bill_reference_number: 'UNKNOWN-REF-001', business_shortcode: '400200',
    reconciliation_status: 'UNMATCHED', matched_student_id: null, matched_fee_balance_id: null,
    matched_at: null, matched_by_user_id: null, raw_callback: { seeded: true, note: 'Deliberately unmatched demo case' },
  });

  await batchInsert(admin, logger, 'fee_balances', schoolId, feeBalanceRows);
  await batchInsert(admin, logger, 'payment_records', schoolId, paymentRecordRows);
  await batchInsert(admin, logger, 'payment_transactions', schoolId, paystackRows);
  await batchInsert(admin, logger, 'payment_paybill_transactions', schoolId, paybillRows);
}
