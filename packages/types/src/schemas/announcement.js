"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CreateAnnouncementInput = exports.AnnouncementAudience = void 0;
const zod_1 = require("zod");
const common_1 = require("./common");
// =============================================================================
// Announcements - text-only in v0.1, distribution via email/SMS/WhatsApp in v0.2
// =============================================================================
exports.AnnouncementAudience = zod_1.z.enum(['SCHOOL_WIDE', 'GRADE', 'CLASS']);
exports.CreateAnnouncementInput = zod_1.z
    .object({
    title: zod_1.z.string().min(1).max(200),
    body: zod_1.z.string().min(1).max(10_000),
    audience: exports.AnnouncementAudience,
    // Required only when audience matches
    targetGradeLevel: zod_1.z.coerce.number().int().min(0).max(20).optional(),
    targetClassId: common_1.Uuid.optional(),
})
    .refine((d) => d.audience !== 'GRADE' || d.targetGradeLevel !== undefined, { message: 'targetGradeLevel is required when audience is GRADE', path: ['targetGradeLevel'] })
    .refine((d) => d.audience !== 'CLASS' || d.targetClassId !== undefined, { message: 'targetClassId is required when audience is CLASS', path: ['targetClassId'] });
