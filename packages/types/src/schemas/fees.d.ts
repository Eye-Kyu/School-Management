import { z } from 'zod';
export declare const MoneyAmount: z.ZodString;
export type MoneyAmount = z.infer<typeof MoneyAmount>;
export declare const UpsertFeeBalanceInput: z.ZodObject<{
    studentId: z.ZodString;
    termId: z.ZodOptional<z.ZodString>;
    amountDue: z.ZodString;
    amountPaid: z.ZodDefault<z.ZodString>;
    currency: z.ZodDefault<z.ZodString>;
    notes: z.ZodOptional<z.ZodString>;
    asOfDate: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    studentId: string;
    amountDue: string;
    amountPaid: string;
    currency: string;
    termId?: string | undefined;
    notes?: string | undefined;
    asOfDate?: string | undefined;
}, {
    studentId: string;
    amountDue: string;
    termId?: string | undefined;
    amountPaid?: string | undefined;
    currency?: string | undefined;
    notes?: string | undefined;
    asOfDate?: string | undefined;
}>;
export type UpsertFeeBalanceInput = z.infer<typeof UpsertFeeBalanceInput>;
export declare const FeeBalanceCsvRow: z.ZodObject<{
    admissionNo: z.ZodString;
    amountDue: z.ZodString;
    amountPaid: z.ZodDefault<z.ZodString>;
    termName: z.ZodOptional<z.ZodString>;
    notes: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    admissionNo: string;
    amountDue: string;
    amountPaid: string;
    notes?: string | undefined;
    termName?: string | undefined;
}, {
    admissionNo: string;
    amountDue: string;
    amountPaid?: string | undefined;
    notes?: string | undefined;
    termName?: string | undefined;
}>;
export type FeeBalanceCsvRow = z.infer<typeof FeeBalanceCsvRow>;
