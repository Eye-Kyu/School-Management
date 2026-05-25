import { z } from 'zod';
import { Uuid, IsoDate } from './common';

// Money is stored as Decimal in the DB. On the wire we use strings to avoid
// JS float pitfalls. Validate as a numeric string.
export const MoneyAmount = z
  .string()
  .regex(/^\d+(\.\d{1,2})?$/, { message: 'Must be a number with up to 2 decimal places' });
export type MoneyAmount = z.infer<typeof MoneyAmount>;

export const UpsertFeeBalanceInput = z.object({
  studentId: Uuid,
  termId: Uuid.optional(),
  amountDue: MoneyAmount,
  amountPaid: MoneyAmount.default('0'),
  currency: z.string().length(3).default('KES'),
  notes: z.string().max(500).optional(),
  asOfDate: IsoDate.optional(),
});
export type UpsertFeeBalanceInput = z.infer<typeof UpsertFeeBalanceInput>;

// CSV bulk-import row format.
export const FeeBalanceCsvRow = z.object({
  admissionNo: z.string().min(1),
  amountDue: MoneyAmount,
  amountPaid: MoneyAmount.default('0'),
  termName: z.string().optional(),
  notes: z.string().optional(),
});
export type FeeBalanceCsvRow = z.infer<typeof FeeBalanceCsvRow>;

export const PAYMENT_METHODS = ['cash', 'bank_transfer', 'mpesa', 'cheque', 'other'] as const;
export type PaymentMethod = typeof PAYMENT_METHODS[number];

export const RecordPaymentInput = z.object({
  feeBalanceId: Uuid,
  amount: MoneyAmount,
  paymentMethod: z.enum(PAYMENT_METHODS),
  referenceNo: z.string().max(100).optional(),
  paidDate: IsoDate,
  notes: z.string().max(500).optional(),
});
export type RecordPaymentInput = z.infer<typeof RecordPaymentInput>;
