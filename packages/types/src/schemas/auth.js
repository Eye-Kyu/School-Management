"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthenticatedUser = exports.PasswordResetConfirmInput = exports.PasswordResetRequestInput = exports.PhoneOtpVerifyInput = exports.PhoneOtpRequestInput = exports.EmailLoginInput = exports.UserRole = void 0;
const zod_1 = require("zod");
const common_1 = require("./common");
// =============================================================================
// User roles - the four core personas
// =============================================================================
exports.UserRole = zod_1.z.enum(['ADMIN', 'TEACHER', 'STUDENT', 'PARENT']);
// =============================================================================
// Login inputs
// =============================================================================
exports.EmailLoginInput = zod_1.z.object({
    email: zod_1.z.string().email(),
    password: zod_1.z.string().min(8, { message: 'Password must be at least 8 characters' }),
});
exports.PhoneOtpRequestInput = zod_1.z.object({
    phone: common_1.PhoneNumber,
});
exports.PhoneOtpVerifyInput = zod_1.z.object({
    phone: common_1.PhoneNumber,
    otp: zod_1.z.string().regex(/^\d{6}$/, { message: 'OTP must be 6 digits' }),
});
// =============================================================================
// Password reset
// =============================================================================
exports.PasswordResetRequestInput = zod_1.z.object({
    email: zod_1.z.string().email(),
});
exports.PasswordResetConfirmInput = zod_1.z
    .object({
    newPassword: zod_1.z.string().min(8),
    confirmPassword: zod_1.z.string().min(8),
})
    .refine((d) => d.newPassword === d.confirmPassword, {
    message: 'Passwords must match',
    path: ['confirmPassword'],
});
// =============================================================================
// Authenticated user payload (returned by /me)
// =============================================================================
exports.AuthenticatedUser = zod_1.z.object({
    id: zod_1.z.string().uuid(),
    schoolId: zod_1.z.string().uuid(),
    email: zod_1.z.string().email().nullable(),
    phone: zod_1.z.string().nullable(),
    fullName: zod_1.z.string(),
    role: exports.UserRole,
});
