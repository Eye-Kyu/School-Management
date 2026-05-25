"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AttendanceRosterQuery = exports.AttendanceQuery = exports.MarkAttendanceInput = exports.AttendanceStatus = void 0;
const zod_1 = require("zod");
const common_1 = require("./common");
// =============================================================================
// Attendance
// =============================================================================
exports.AttendanceStatus = zod_1.z.enum(['PRESENT', 'ABSENT', 'LATE', 'EXCUSED']);
// Teacher marks a whole class at once - one row per student.
exports.MarkAttendanceInput = zod_1.z.object({
    classId: common_1.Uuid,
    date: common_1.IsoDate,
    records: zod_1.z
        .array(zod_1.z.object({
        studentId: common_1.Uuid,
        status: exports.AttendanceStatus,
        note: zod_1.z.string().max(500).optional(),
    }))
        .min(1, { message: 'At least one student record is required' }),
});
// Used to filter the per-student attendance history view.
exports.AttendanceQuery = zod_1.z.object({
    studentId: common_1.Uuid.optional(),
    classId: common_1.Uuid.optional(),
    startDate: common_1.IsoDate.optional(),
    endDate: common_1.IsoDate.optional(),
});
// Fetches the student roster for a class on a given date, with existing statuses.
exports.AttendanceRosterQuery = zod_1.z.object({
    classId: common_1.Uuid,
    date: common_1.IsoDate,
});
