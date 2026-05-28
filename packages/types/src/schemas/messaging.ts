import { z } from 'zod';
import { Uuid } from './common';

export const CreateConversationInput = z.object({
  teacherUserId: Uuid,
  studentId: Uuid.optional(),
  firstMessage: z.string().min(1).max(2000).trim(),
});
export type CreateConversationInput = z.infer<typeof CreateConversationInput>;

export const SendMessageInput = z.object({
  body: z.string().min(1).max(2000).trim(),
});
export type SendMessageInput = z.infer<typeof SendMessageInput>;
