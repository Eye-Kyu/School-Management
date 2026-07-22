import { z } from 'zod';

// =============================================================================
// Platform billing - a manual invoice ledger against schools' package
// subscriptions. No payment gateway: the SuperAdmin generates invoices and
// marks them PAID/CANCELLED by hand. OVERDUE is computed server-side (a
// PENDING invoice past its due_date), never client-set.
// =============================================================================

export const InvoiceStatus = z.enum(['PENDING', 'PAID', 'OVERDUE', 'CANCELLED']);
export type InvoiceStatus = z.infer<typeof InvoiceStatus>;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'Must be an ISO date (YYYY-MM-DD)' });

export const CreatePlatformInvoiceInput = z.object({
  periodStart: isoDate,
  periodEnd: isoDate,
  dueDate: isoDate,
  notes: z.string().max(1000).optional(),
});
export type CreatePlatformInvoiceInput = z.infer<typeof CreatePlatformInvoiceInput>;

export const UpdatePlatformInvoiceStatusInput = z.object({
  status: z.enum(['PAID', 'CANCELLED']),
  paidAt: z.string().datetime().optional(),
  notes: z.string().max(1000).optional(),
});
export type UpdatePlatformInvoiceStatusInput = z.infer<typeof UpdatePlatformInvoiceStatusInput>;
