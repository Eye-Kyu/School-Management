import { z } from 'zod';
import { Uuid, Pagination } from './common';

export const DocumentScopeType = z.enum(['SCHOOL_WIDE', 'CLASS', 'SUBJECT', 'ASSIGNMENT']);
export type DocumentScopeType = z.infer<typeof DocumentScopeType>;

// 'ONLINE_ASSIGNMENT', not 'ASSIGNMENT' — the latter would collide with the
// outer scope_type='ASSIGNMENT' value. There are three distinct
// assignment-like tables a document can attach to (homework_assignments,
// quizzes, assignments); scope_type alone can't say which one scope_id
// points into.
export const DocumentScopeSubtype = z.enum(['HOMEWORK', 'QUIZ', 'ONLINE_ASSIGNMENT']);
export type DocumentScopeSubtype = z.infer<typeof DocumentScopeSubtype>;

const scopeFields = {
  scopeType: DocumentScopeType,
  scopeSubtype: DocumentScopeSubtype.optional(),
  scopeId: Uuid.optional(),
};

// Mirrors the DB's documents_scope_check constraint exactly, so a malformed
// request gets a friendly 400 instead of a raw DB constraint error.
function refineScope<T extends z.ZodRawShape>(schema: z.ZodObject<T>) {
  return schema.refine(
    (v) => {
      if (v.scopeType === 'SCHOOL_WIDE') return !v.scopeId && !v.scopeSubtype;
      if (v.scopeType === 'CLASS' || v.scopeType === 'SUBJECT') return !!v.scopeId && !v.scopeSubtype;
      if (v.scopeType === 'ASSIGNMENT') return !!v.scopeId && !!v.scopeSubtype;
      return false;
    },
    { message: 'scopeId/scopeSubtype do not match scopeType', path: ['scopeId'] },
  );
}

// Multipart fields arrive as flat strings via multer — no nested JSON.
// `tags` is comma-separated text, matching the pre-existing admin upload
// form's own convention.
export const UploadDocumentInput = refineScope(z.object({
  title: z.string().min(1).max(300),
  tags: z.string().optional().transform((s) => (s ? s.split(',').map((t) => t.trim()).filter(Boolean) : [])),
  ...scopeFields,
}));
export type UploadDocumentInput = z.infer<typeof UploadDocumentInput>;

// JSON PATCH body, not multipart — tags is a plain array here.
export const RetagDocumentInput = refineScope(z.object({
  title: z.string().min(1).max(300).optional(),
  tags: z.array(z.string()).optional(),
  ...scopeFields,
}));
export type RetagDocumentInput = z.infer<typeof RetagDocumentInput>;

export const DocumentQuery = z.object({
  scopeType: DocumentScopeType.optional(),
  scopeSubtype: DocumentScopeSubtype.optional(),
  scopeId: Uuid.optional(),
  uploaderId: Uuid.optional(),
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  q: z.string().max(200).optional(),
}).merge(Pagination);
export type DocumentQuery = z.infer<typeof DocumentQuery>;
