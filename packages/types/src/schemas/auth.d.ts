import { z } from 'zod';
export declare const UserRole: z.ZodEnum<["ADMIN", "TEACHER", "STUDENT", "PARENT"]>;
export type UserRole = z.infer<typeof UserRole>;
export declare const EmailLoginInput: z.ZodObject<{
    email: z.ZodString;
    password: z.ZodString;
}, "strip", z.ZodTypeAny, {
    email: string;
    password: string;
}, {
    email: string;
    password: string;
}>;
export type EmailLoginInput = z.infer<typeof EmailLoginInput>;
export declare const PhoneOtpRequestInput: z.ZodObject<{
    phone: z.ZodString;
}, "strip", z.ZodTypeAny, {
    phone: string;
}, {
    phone: string;
}>;
export type PhoneOtpRequestInput = z.infer<typeof PhoneOtpRequestInput>;
export declare const PhoneOtpVerifyInput: z.ZodObject<{
    phone: z.ZodString;
    otp: z.ZodString;
}, "strip", z.ZodTypeAny, {
    phone: string;
    otp: string;
}, {
    phone: string;
    otp: string;
}>;
export type PhoneOtpVerifyInput = z.infer<typeof PhoneOtpVerifyInput>;
export declare const PasswordResetRequestInput: z.ZodObject<{
    email: z.ZodString;
}, "strip", z.ZodTypeAny, {
    email: string;
}, {
    email: string;
}>;
export type PasswordResetRequestInput = z.infer<typeof PasswordResetRequestInput>;
export declare const PasswordResetConfirmInput: z.ZodEffects<z.ZodObject<{
    newPassword: z.ZodString;
    confirmPassword: z.ZodString;
}, "strip", z.ZodTypeAny, {
    newPassword: string;
    confirmPassword: string;
}, {
    newPassword: string;
    confirmPassword: string;
}>, {
    newPassword: string;
    confirmPassword: string;
}, {
    newPassword: string;
    confirmPassword: string;
}>;
export type PasswordResetConfirmInput = z.infer<typeof PasswordResetConfirmInput>;
export declare const AuthenticatedUser: z.ZodObject<{
    id: z.ZodString;
    schoolId: z.ZodString;
    email: z.ZodNullable<z.ZodString>;
    phone: z.ZodNullable<z.ZodString>;
    fullName: z.ZodString;
    role: z.ZodEnum<["ADMIN", "TEACHER", "STUDENT", "PARENT"]>;
}, "strip", z.ZodTypeAny, {
    id: string;
    email: string | null;
    phone: string | null;
    role: "ADMIN" | "TEACHER" | "STUDENT" | "PARENT";
    schoolId: string;
    fullName: string;
}, {
    id: string;
    email: string | null;
    phone: string | null;
    role: "ADMIN" | "TEACHER" | "STUDENT" | "PARENT";
    schoolId: string;
    fullName: string;
}>;
export type AuthenticatedUser = z.infer<typeof AuthenticatedUser>;
