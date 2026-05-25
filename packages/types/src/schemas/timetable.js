"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UpdateTimetableSlotInput = exports.CreateTimetableSlotInput = exports.DayOfWeek = void 0;
const zod_1 = require("zod");
const common_1 = require("./common");
// =============================================================================
// Timetable
// =============================================================================
exports.DayOfWeek = zod_1.z.enum([
    'MONDAY',
    'TUESDAY',
    'WEDNESDAY',
    'THURSDAY',
    'FRIDAY',
    'SATURDAY',
    'SUNDAY',
]);
exports.CreateTimetableSlotInput = zod_1.z
    .object({
    classId: common_1.Uuid,
    subjectId: common_1.Uuid,
    teacherId: common_1.Uuid,
    dayOfWeek: exports.DayOfWeek,
    startTime: common_1.TimeOfDay,
    endTime: common_1.TimeOfDay,
    room: zod_1.z.string().max(50).optional(),
})
    .refine((d) => d.startTime < d.endTime, {
    message: 'startTime must be before endTime',
    path: ['endTime'],
});
exports.UpdateTimetableSlotInput = exports.CreateTimetableSlotInput.innerType().partial();
