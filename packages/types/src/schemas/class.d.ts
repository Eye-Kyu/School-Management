import { z } from 'zod';
export declare const CreateClassInput: z.ZodObject<{
    name: z.ZodString;
    gradeLevel: z.ZodNumber;
    stream: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    name: string;
    gradeLevel: number;
    stream?: string | undefined;
}, {
    name: string;
    gradeLevel: number;
    stream?: string | undefined;
}>;
export type CreateClassInput = z.infer<typeof CreateClassInput>;
export declare const UpdateClassInput: z.ZodObject<{
    name: z.ZodOptional<z.ZodString>;
    gradeLevel: z.ZodOptional<z.ZodNumber>;
    stream: z.ZodOptional<z.ZodOptional<z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    name?: string | undefined;
    gradeLevel?: number | undefined;
    stream?: string | undefined;
}, {
    name?: string | undefined;
    gradeLevel?: number | undefined;
    stream?: string | undefined;
}>;
export type UpdateClassInput = z.infer<typeof UpdateClassInput>;
export declare const CreateSubjectInput: z.ZodObject<{
    name: z.ZodString;
    code: z.ZodString;
}, "strip", z.ZodTypeAny, {
    name: string;
    code: string;
}, {
    name: string;
    code: string;
}>;
export type CreateSubjectInput = z.infer<typeof CreateSubjectInput>;
export declare const AssignSubjectInput: z.ZodObject<{
    classId: z.ZodString;
    subjectId: z.ZodString;
    teacherId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    classId: string;
    subjectId: string;
    teacherId: string;
}, {
    classId: string;
    subjectId: string;
    teacherId: string;
}>;
export type AssignSubjectInput = z.infer<typeof AssignSubjectInput>;
export declare const CreateTermInput: z.ZodEffects<z.ZodObject<{
    name: z.ZodString;
    startDate: z.ZodString;
    endDate: z.ZodString;
    isCurrent: z.ZodDefault<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    name: string;
    startDate: string;
    endDate: string;
    isCurrent: boolean;
}, {
    name: string;
    startDate: string;
    endDate: string;
    isCurrent?: boolean | undefined;
}>, {
    name: string;
    startDate: string;
    endDate: string;
    isCurrent: boolean;
}, {
    name: string;
    startDate: string;
    endDate: string;
    isCurrent?: boolean | undefined;
}>;
export type CreateTermInput = z.infer<typeof CreateTermInput>;
