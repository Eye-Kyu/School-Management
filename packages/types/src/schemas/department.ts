import { z } from 'zod';
import { Uuid } from './common';

export const SetDepartmentHeadInput = z.object({
  teacherUserId: Uuid.nullable(),
});
export type SetDepartmentHeadInput = z.infer<typeof SetDepartmentHeadInput>;

export const CreateDepartmentInput = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(1000).optional(),
});
export type CreateDepartmentInput = z.infer<typeof CreateDepartmentInput>;

export const UpdateDepartmentInput = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(1000).optional(),
});
export type UpdateDepartmentInput = z.infer<typeof UpdateDepartmentInput>;
