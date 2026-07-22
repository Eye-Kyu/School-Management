import { z } from 'zod';

// =============================================================================
// Curriculum catalog schemas
// =============================================================================
// A global, platform-level reference layer (e.g. "Kenya CBC", "8-4-4") with a
// grade-level -> subject list per curriculum. Informational only — assigning
// a curriculum to a school never modifies that school's own tenant-scoped
// subjects/classes/terms tables.
// =============================================================================

export const CreateCurriculumInput = z.object({
  name: z.string().min(1).max(150),
  description: z.string().max(1000).optional(),
  displayOrder: z.number().int().default(0),
});
export type CreateCurriculumInput = z.infer<typeof CreateCurriculumInput>;

export const UpdateCurriculumInput = CreateCurriculumInput.partial().extend({
  isActive: z.boolean().optional(),
});
export type UpdateCurriculumInput = z.infer<typeof UpdateCurriculumInput>;

export const SetCurriculumSubjectsInput = z.object({
  subjects: z.array(z.object({
    gradeLevel: z.number().int().min(0).max(20),
    name: z.string().min(1).max(100),
    code: z.string().max(20).optional(),
  })),
});
export type SetCurriculumSubjectsInput = z.infer<typeof SetCurriculumSubjectsInput>;

export const AssignCurriculumInput = z.object({
  curriculumId: z.string().uuid().nullable(),
});
export type AssignCurriculumInput = z.infer<typeof AssignCurriculumInput>;
