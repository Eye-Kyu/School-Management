import { z } from 'zod';
export declare const AnnouncementAudience: z.ZodEnum<["SCHOOL_WIDE", "GRADE", "CLASS"]>;
export type AnnouncementAudience = z.infer<typeof AnnouncementAudience>;
export declare const CreateAnnouncementInput: z.ZodEffects<z.ZodEffects<z.ZodObject<{
    title: z.ZodString;
    body: z.ZodString;
    audience: z.ZodEnum<["SCHOOL_WIDE", "GRADE", "CLASS"]>;
    targetGradeLevel: z.ZodOptional<z.ZodNumber>;
    targetClassId: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    title: string;
    body: string;
    audience: "SCHOOL_WIDE" | "GRADE" | "CLASS";
    targetGradeLevel?: number | undefined;
    targetClassId?: string | undefined;
}, {
    title: string;
    body: string;
    audience: "SCHOOL_WIDE" | "GRADE" | "CLASS";
    targetGradeLevel?: number | undefined;
    targetClassId?: string | undefined;
}>, {
    title: string;
    body: string;
    audience: "SCHOOL_WIDE" | "GRADE" | "CLASS";
    targetGradeLevel?: number | undefined;
    targetClassId?: string | undefined;
}, {
    title: string;
    body: string;
    audience: "SCHOOL_WIDE" | "GRADE" | "CLASS";
    targetGradeLevel?: number | undefined;
    targetClassId?: string | undefined;
}>, {
    title: string;
    body: string;
    audience: "SCHOOL_WIDE" | "GRADE" | "CLASS";
    targetGradeLevel?: number | undefined;
    targetClassId?: string | undefined;
}, {
    title: string;
    body: string;
    audience: "SCHOOL_WIDE" | "GRADE" | "CLASS";
    targetGradeLevel?: number | undefined;
    targetClassId?: string | undefined;
}>;
export type CreateAnnouncementInput = z.infer<typeof CreateAnnouncementInput>;
