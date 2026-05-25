"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PaginatedResponse = exports.Pagination = exports.PhoneNumber = exports.TimeOfDay = exports.IsoDate = exports.Uuid = void 0;
const zod_1 = require("zod");
// =============================================================================
// Common building blocks reused across other schemas
// =============================================================================
// All our IDs are UUIDs.
exports.Uuid = zod_1.z.string().uuid({ message: 'Must be a valid UUID' });
// ISO date string 'YYYY-MM-DD' (no time component).
exports.IsoDate = zod_1.z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'Must be YYYY-MM-DD' });
// Time-of-day string 'HH:MM' in 24h.
exports.TimeOfDay = zod_1.z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'Must be HH:MM (24h)' });
// Phone number - liberal regex, real validation happens on the provider side.
// Accepts E.164 format like +254700000000.
exports.PhoneNumber = zod_1.z
    .string()
    .regex(/^\+\d{7,15}$/, { message: 'Must be E.164 format e.g. +254700000000' });
// Standard pagination query params.
exports.Pagination = zod_1.z.object({
    page: zod_1.z.coerce.number().int().min(1).default(1),
    pageSize: zod_1.z.coerce.number().int().min(1).max(100).default(25),
});
// Standard envelope for paginated API responses.
const PaginatedResponse = (item) => zod_1.z.object({
    data: zod_1.z.array(item),
    page: zod_1.z.number().int(),
    pageSize: zod_1.z.number().int(),
    total: zod_1.z.number().int(),
});
exports.PaginatedResponse = PaginatedResponse;
