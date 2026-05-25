import { z } from 'zod';
export declare const CreateSchoolInput: z.ZodObject<{
    name: z.ZodString;
    slug: z.ZodString;
    phone: z.ZodOptional<z.ZodString>;
    email: z.ZodOptional<z.ZodString>;
    address: z.ZodOptional<z.ZodString>;
    timezone: z.ZodDefault<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    name: string;
    slug: string;
    timezone: string;
    email?: string | undefined;
    phone?: string | undefined;
    address?: string | undefined;
}, {
    name: string;
    slug: string;
    email?: string | undefined;
    phone?: string | undefined;
    address?: string | undefined;
    timezone?: string | undefined;
}>;
export type CreateSchoolInput = z.infer<typeof CreateSchoolInput>;
export declare const UpdateSchoolInput: z.ZodObject<Omit<{
    name: z.ZodOptional<z.ZodString>;
    slug: z.ZodOptional<z.ZodString>;
    phone: z.ZodOptional<z.ZodOptional<z.ZodString>>;
    email: z.ZodOptional<z.ZodOptional<z.ZodString>>;
    address: z.ZodOptional<z.ZodOptional<z.ZodString>>;
    timezone: z.ZodOptional<z.ZodDefault<z.ZodString>>;
}, "slug">, "strip", z.ZodTypeAny, {
    email?: string | undefined;
    phone?: string | undefined;
    name?: string | undefined;
    address?: string | undefined;
    timezone?: string | undefined;
}, {
    email?: string | undefined;
    phone?: string | undefined;
    name?: string | undefined;
    address?: string | undefined;
    timezone?: string | undefined;
}>;
export type UpdateSchoolInput = z.infer<typeof UpdateSchoolInput>;
