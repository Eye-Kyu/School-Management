import { z } from 'zod';
import { UserRole } from './auth';
export declare const CreateTeacherInput: z.ZodObject<{
    fullName: z.ZodString;
    email: z.ZodOptional<z.ZodString>;
    phone: z.ZodOptional<z.ZodString>;
} & {
    staffNo: z.ZodString;
}, "strip", z.ZodTypeAny, {
    fullName: string;
    staffNo: string;
    email?: string | undefined;
    phone?: string | undefined;
}, {
    fullName: string;
    staffNo: string;
    email?: string | undefined;
    phone?: string | undefined;
}>;
export type CreateTeacherInput = z.infer<typeof CreateTeacherInput>;
export declare const CreateStudentInput: z.ZodObject<{
    fullName: z.ZodString;
    email: z.ZodOptional<z.ZodString>;
    phone: z.ZodOptional<z.ZodString>;
} & {
    admissionNo: z.ZodString;
    dateOfBirth: z.ZodOptional<z.ZodString>;
    gender: z.ZodOptional<z.ZodEnum<["MALE", "FEMALE", "OTHER"]>>;
    classId: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    fullName: string;
    admissionNo: string;
    email?: string | undefined;
    phone?: string | undefined;
    dateOfBirth?: string | undefined;
    gender?: "MALE" | "FEMALE" | "OTHER" | undefined;
    classId?: string | undefined;
}, {
    fullName: string;
    admissionNo: string;
    email?: string | undefined;
    phone?: string | undefined;
    dateOfBirth?: string | undefined;
    gender?: "MALE" | "FEMALE" | "OTHER" | undefined;
    classId?: string | undefined;
}>;
export type CreateStudentInput = z.infer<typeof CreateStudentInput>;
export declare const CreateParentInput: z.ZodObject<{
    fullName: z.ZodString;
    email: z.ZodOptional<z.ZodString>;
    phone: z.ZodOptional<z.ZodString>;
} & {
    childAdmissionNos: z.ZodArray<z.ZodString, "many">;
    relationship: z.ZodDefault<z.ZodEnum<["MOTHER", "FATHER", "GUARDIAN", "OTHER"]>>;
}, "strip", z.ZodTypeAny, {
    fullName: string;
    childAdmissionNos: string[];
    relationship: "OTHER" | "MOTHER" | "FATHER" | "GUARDIAN";
    email?: string | undefined;
    phone?: string | undefined;
}, {
    fullName: string;
    childAdmissionNos: string[];
    email?: string | undefined;
    phone?: string | undefined;
    relationship?: "OTHER" | "MOTHER" | "FATHER" | "GUARDIAN" | undefined;
}>;
export type CreateParentInput = z.infer<typeof CreateParentInput>;
export declare const UpdateUserInput: z.ZodObject<{
    fullName: z.ZodOptional<z.ZodString>;
    email: z.ZodOptional<z.ZodString>;
    phone: z.ZodOptional<z.ZodString>;
    isActive: z.ZodOptional<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    email?: string | undefined;
    phone?: string | undefined;
    fullName?: string | undefined;
    isActive?: boolean | undefined;
}, {
    email?: string | undefined;
    phone?: string | undefined;
    fullName?: string | undefined;
    isActive?: boolean | undefined;
}>;
export type UpdateUserInput = z.infer<typeof UpdateUserInput>;
export declare const StudentCsvRow: z.ZodObject<{
    admissionNo: z.ZodString;
    fullName: z.ZodString;
    className: z.ZodString;
    dateOfBirth: z.ZodOptional<z.ZodString>;
    gender: z.ZodOptional<z.ZodEnum<["MALE", "FEMALE", "OTHER"]>>;
    guardianFullName: z.ZodOptional<z.ZodString>;
    guardianPhone: z.ZodOptional<z.ZodString>;
    guardianEmail: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    fullName: string;
    admissionNo: string;
    className: string;
    dateOfBirth?: string | undefined;
    gender?: "MALE" | "FEMALE" | "OTHER" | undefined;
    guardianFullName?: string | undefined;
    guardianPhone?: string | undefined;
    guardianEmail?: string | undefined;
}, {
    fullName: string;
    admissionNo: string;
    className: string;
    dateOfBirth?: string | undefined;
    gender?: "MALE" | "FEMALE" | "OTHER" | undefined;
    guardianFullName?: string | undefined;
    guardianPhone?: string | undefined;
    guardianEmail?: string | undefined;
}>;
export type StudentCsvRow = z.infer<typeof StudentCsvRow>;
export { UserRole };
