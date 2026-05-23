import { z } from 'zod';
import { Uuid, IsoDate } from './common';

// =============================================================================
// Fees - v0.1 is view-only (CSV import by admin, parents see balance)
// Payment processing arrives in v0.2.
// =============================================================================

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
