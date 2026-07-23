import { z } from 'zod';
import { Uuid } from './common';

// recipientUserId is a teacher when the sender is a PARENT or TEACHER-scoped
// PARENT contact, or either a teacher or a parent when the sender is an ADMIN
// (recipientRole disambiguates that case; it's ignored for non-admin senders).
// bypassQuietHours is only honored when the sender is an ADMIN — enforced
// again server-side and by the msg_insert RLS policy, not just by this schema.
export const CreateConversationInput = z.object({
  recipientUserId: Uuid,
  recipientRole: z.enum(['TEACHER', 'PARENT']).optional(),
  studentId: Uuid.optional(),
  firstMessage: z.string().min(1).max(2000).trim(),
  bypassQuietHours: z.boolean().optional(),
});
export type CreateConversationInput = z.infer<typeof CreateConversationInput>;

export const SendMessageInput = z.object({
  body: z.string().min(1).max(2000).trim(),
});
export type SendMessageInput = z.infer<typeof SendMessageInput>;

// Class Teacher only — creates one one-to-one conversation per parent in the
// class, never a group thread.
export const BroadcastToClassInput = z.object({
  classId: Uuid,
  body: z.string().min(1).max(2000).trim(),
});
export type BroadcastToClassInput = z.infer<typeof BroadcastToClassInput>;
