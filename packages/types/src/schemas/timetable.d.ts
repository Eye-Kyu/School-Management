import { z } from 'zod';
export declare const DayOfWeek: z.ZodEnum<["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"]>;
export type DayOfWeek = z.infer<typeof DayOfWeek>;
export declare const CreateTimetableSlotInput: z.ZodEffects<z.ZodObject<{
    classId: z.ZodString;
    subjectId: z.ZodString;
    teacherId: z.ZodString;
    dayOfWeek: z.ZodEnum<["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"]>;
    startTime: z.ZodString;
    endTime: z.ZodString;
    room: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    classId: string;
    subjectId: string;
    teacherId: string;
    dayOfWeek: "MONDAY" | "TUESDAY" | "WEDNESDAY" | "THURSDAY" | "FRIDAY" | "SATURDAY" | "SUNDAY";
    startTime: string;
    endTime: string;
    room?: string | undefined;
}, {
    classId: string;
    subjectId: string;
    teacherId: string;
    dayOfWeek: "MONDAY" | "TUESDAY" | "WEDNESDAY" | "THURSDAY" | "FRIDAY" | "SATURDAY" | "SUNDAY";
    startTime: string;
    endTime: string;
    room?: string | undefined;
}>, {
    classId: string;
    subjectId: string;
    teacherId: string;
    dayOfWeek: "MONDAY" | "TUESDAY" | "WEDNESDAY" | "THURSDAY" | "FRIDAY" | "SATURDAY" | "SUNDAY";
    startTime: string;
    endTime: string;
    room?: string | undefined;
}, {
    classId: string;
    subjectId: string;
    teacherId: string;
    dayOfWeek: "MONDAY" | "TUESDAY" | "WEDNESDAY" | "THURSDAY" | "FRIDAY" | "SATURDAY" | "SUNDAY";
    startTime: string;
    endTime: string;
    room?: string | undefined;
}>;
export type CreateTimetableSlotInput = z.infer<typeof CreateTimetableSlotInput>;
export declare const UpdateTimetableSlotInput: z.ZodObject<{
    classId: z.ZodOptional<z.ZodString>;
    subjectId: z.ZodOptional<z.ZodString>;
    teacherId: z.ZodOptional<z.ZodString>;
    dayOfWeek: z.ZodOptional<z.ZodEnum<["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"]>>;
    startTime: z.ZodOptional<z.ZodString>;
    endTime: z.ZodOptional<z.ZodString>;
    room: z.ZodOptional<z.ZodOptional<z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    classId?: string | undefined;
    subjectId?: string | undefined;
    teacherId?: string | undefined;
    dayOfWeek?: "MONDAY" | "TUESDAY" | "WEDNESDAY" | "THURSDAY" | "FRIDAY" | "SATURDAY" | "SUNDAY" | undefined;
    startTime?: string | undefined;
    endTime?: string | undefined;
    room?: string | undefined;
}, {
    classId?: string | undefined;
    subjectId?: string | undefined;
    teacherId?: string | undefined;
    dayOfWeek?: "MONDAY" | "TUESDAY" | "WEDNESDAY" | "THURSDAY" | "FRIDAY" | "SATURDAY" | "SUNDAY" | undefined;
    startTime?: string | undefined;
    endTime?: string | undefined;
    room?: string | undefined;
}>;
export type UpdateTimetableSlotInput = z.infer<typeof UpdateTimetableSlotInput>;
