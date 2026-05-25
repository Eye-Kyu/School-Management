import { z } from 'zod';
export declare const Uuid: z.ZodString;
export type Uuid = z.infer<typeof Uuid>;
export declare const IsoDate: z.ZodString;
export type IsoDate = z.infer<typeof IsoDate>;
export declare const TimeOfDay: z.ZodString;
export type TimeOfDay = z.infer<typeof TimeOfDay>;
export declare const PhoneNumber: z.ZodString;
export type PhoneNumber = z.infer<typeof PhoneNumber>;
export declare const Pagination: z.ZodObject<{
    page: z.ZodDefault<z.ZodNumber>;
    pageSize: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    page: number;
    pageSize: number;
}, {
    page?: number | undefined;
    pageSize?: number | undefined;
}>;
export type Pagination = z.infer<typeof Pagination>;
export declare const PaginatedResponse: <T extends z.ZodTypeAny>(item: T) => z.ZodObject<{
    data: z.ZodArray<T, "many">;
    page: z.ZodNumber;
    pageSize: z.ZodNumber;
    total: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    data: T["_output"][];
    page: number;
    pageSize: number;
    total: number;
}, {
    data: T["_input"][];
    page: number;
    pageSize: number;
    total: number;
}>;
