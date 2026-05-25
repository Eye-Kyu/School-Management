import { z } from 'zod';
export declare const AttendanceStatus: z.ZodEnum<["PRESENT", "ABSENT", "LATE", "EXCUSED"]>;
export type AttendanceStatus = z.infer<typeof AttendanceStatus>;
export declare const MarkAttendanceInput: z.ZodObject<{
    classId: z.ZodString;
    date: z.ZodString;
    records: z.ZodArray<z.ZodObject<{
        studentId: z.ZodString;
        status: z.ZodEnum<["PRESENT", "ABSENT", "LATE", "EXCUSED"]>;
        note: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        status: "PRESENT" | "ABSENT" | "LATE" | "EXCUSED";
        studentId: string;
        note?: string | undefined;
    }, {
        status: "PRESENT" | "ABSENT" | "LATE" | "EXCUSED";
        studentId: string;
        note?: string | undefined;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    date: string;
    classId: string;
    records: {
        status: "PRESENT" | "ABSENT" | "LATE" | "EXCUSED";
        studentId: string;
        note?: string | undefined;
    }[];
}, {
    date: string;
    classId: string;
    records: {
        status: "PRESENT" | "ABSENT" | "LATE" | "EXCUSED";
        studentId: string;
        note?: string | undefined;
    }[];
}>;
export type MarkAttendanceInput = z.infer<typeof MarkAttendanceInput>;
export declare const AttendanceQuery: z.ZodObject<{
    studentId: z.ZodOptional<z.ZodString>;
    classId: z.ZodOptional<z.ZodString>;
    startDate: z.ZodOptional<z.ZodString>;
    endDate: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    classId?: string | undefined;
    startDate?: string | undefined;
    endDate?: string | undefined;
    studentId?: string | undefined;
}, {
    classId?: string | undefined;
    startDate?: string | undefined;
    endDate?: string | undefined;
    studentId?: string | undefined;
}>;
export type AttendanceQuery = z.infer<typeof AttendanceQuery>;
export declare const AttendanceRosterQuery: z.ZodObject<{
    classId: z.ZodString;
    date: z.ZodString;
}, "strip", z.ZodTypeAny, {
    date: string;
    classId: string;
}, {
    date: string;
    classId: string;
}>;
export type AttendanceRosterQuery = z.infer<typeof AttendanceRosterQuery>;
