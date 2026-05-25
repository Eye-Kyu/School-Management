"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UserRole = exports.StudentCsvRow = exports.UpdateUserInput = exports.CreateParentInput = exports.CreateStudentInput = exports.CreateTeacherInput = void 0;
const zod_1 = require("zod");
const common_1 = require("./common");
const auth_1 = require("./auth");
Object.defineProperty(exports, "UserRole", { enumerable: true, get: function () { return auth_1.UserRole; } });
// =============================================================================
// User creation - admins create teachers, students, parents
// =============================================================================
// One user can have one role. A parent who is also a teacher would need
// two accounts in v0.1 (kept simple deliberately).
// =============================================================================
const BaseUser = zod_1.z.object({
    fullName: zod_1.z.string().min(2).max(200),
    email: zod_1.z.string().email().optional(),
    phone: common_1.PhoneNumber.optional(),
});
exports.CreateTeacherInput = BaseUser.extend({
    staffNo: zod_1.z.string().min(1).max(50),
});
exports.CreateStudentInput = BaseUser.extend({
    admissionNo: zod_1.z.string().min(1).max(50),
    dateOfBirth: common_1.IsoDate.optional(),
    gender: zod_1.z.enum(['MALE', 'FEMALE', 'OTHER']).optional(),
    classId: common_1.Uuid.optional(),
});
exports.CreateParentInput = BaseUser.extend({
    // A parent is linked to one or more students at creation time.
    childAdmissionNos: zod_1.z.array(zod_1.z.string().min(1)).min(1, {
        message: 'A parent must be linked to at least one student',
    }),
    relationship: zod_1.z.enum(['MOTHER', 'FATHER', 'GUARDIAN', 'OTHER']).default('GUARDIAN'),
});
// Used by the admin's "edit user" form. Most fields optional.
exports.UpdateUserInput = zod_1.z.object({
    fullName: zod_1.z.string().min(2).max(200).optional(),
    email: zod_1.z.string().email().optional(),
    phone: common_1.PhoneNumber.optional(),
    isActive: zod_1.z.boolean().optional(),
});
// CSV bulk-import - one row at a time, server validates each.
exports.StudentCsvRow = zod_1.z.object({
    admissionNo: zod_1.z.string().min(1),
    fullName: zod_1.z.string().min(2),
    className: zod_1.z.string().min(1),
    dateOfBirth: common_1.IsoDate.optional(),
    gender: zod_1.z.enum(['MALE', 'FEMALE', 'OTHER']).optional(),
    guardianFullName: zod_1.z.string().optional(),
    guardianPhone: common_1.PhoneNumber.optional(),
    guardianEmail: zod_1.z.string().email().optional(),
});
