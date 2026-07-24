import { z } from 'zod';
import { Uuid } from './common';

// =============================================================================
// SuperAdmin -> SchoolAdmin broadcast messaging (one-way, in-app only)
// =============================================================================

export const PlatformMessageAudience = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ALL') }),
  z.object({ type: z.literal('PACKAGE'), packageId: Uuid }),
  z.object({ type: z.literal('MANUAL'), schoolIds: z.array(Uuid).min(1) }),
]);
export type PlatformMessageAudience = z.infer<typeof PlatformMessageAudience>;

export const SendPlatformMessageInput = z.object({
  subject: z.string().min(1).max(200),
  body: z.string().min(1).max(5000),
  audience: PlatformMessageAudience,
});
export type SendPlatformMessageInput = z.infer<typeof SendPlatformMessageInput>;
