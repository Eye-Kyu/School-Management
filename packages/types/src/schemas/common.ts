import { z } from 'zod';

// =============================================================================
// Common building blocks reused across other schemas
// =============================================================================

// All our IDs are UUIDs.
export const Uuid = z.string().uuid({ message: 'Must be a valid UUID' });
export type Uuid = z.infer<typeof Uuid>;

// ISO date string 'YYYY-MM-DD' (no time component).
export const IsoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'Must be YYYY-MM-DD' });
export type IsoDate = z.infer<typeof IsoDate>;

// Time-of-day string 'HH:MM' in 24h.
export const TimeOfDay = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'Must be HH:MM (24h)' });
export type TimeOfDay = z.infer<typeof TimeOfDay>;

// Phone number - liberal regex, real validation happens on the provider side.
// Accepts E.164 format like +254700000000.
export const PhoneNumber = z
  .string()
  .regex(/^\+\d{7,15}$/, { message: 'Must be E.164 format e.g. +254700000000' });
export type PhoneNumber = z.infer<typeof PhoneNumber>;

// Standard pagination query params.
export const Pagination = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type Pagination = z.infer<typeof Pagination>;

// Standard envelope for paginated API responses.
export const PaginatedResponse = <T extends z.ZodTypeAny>(item: T) =>
  z.object({
    data: z.array(item),
    page: z.number().int(),
    pageSize: z.number().int(),
    total: z.number().int(),
  });
