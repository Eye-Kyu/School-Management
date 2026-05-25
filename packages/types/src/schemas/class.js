"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CreateTermInput = exports.AssignSubjectInput = exports.CreateSubjectInput = exports.UpdateClassInput = exports.CreateClassInput = void 0;
const zod_1 = require("zod");
const common_1 = require("./common");
// =============================================================================
// Classes, subjects, terms
// =============================================================================
exports.CreateClassInput = zod_1.z.object({
    name: zod_1.z.string().min(1).max(100), // 'Grade 5 Blue'
    gradeLevel: zod_1.z.coerce.number().int().min(0).max(20),
    stream: zod_1.z.string().max(50).optional(), // 'Blue', 'North', 'A'
});
exports.UpdateClassInput = exports.CreateClassInput.partial();
exports.CreateSubjectInput = zod_1.z.object({
    name: zod_1.z.string().min(1).max(100),
    code: zod_1.z
        .string()
        .min(1)
        .max(20)
        .regex(/^[A-Z0-9_]+$/, {
        message: 'Subject code must be uppercase letters, digits, underscores',
    }),
});
exports.AssignSubjectInput = zod_1.z.object({
    classId: common_1.Uuid,
    subjectId: common_1.Uuid,
    teacherId: common_1.Uuid,
});
exports.CreateTermInput = zod_1.z
    .object({
    name: zod_1.z.string().min(1).max(100), // 'Term 1 2026'
    startDate: common_1.IsoDate,
    endDate: common_1.IsoDate,
    isCurrent: zod_1.z.boolean().default(false),
})
    .refine((d) => d.startDate < d.endDate, {
    message: 'startDate must be before endDate',
    path: ['endDate'],
});
