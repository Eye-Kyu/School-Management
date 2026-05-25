"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FeeBalanceCsvRow = exports.UpsertFeeBalanceInput = exports.MoneyAmount = void 0;
const zod_1 = require("zod");
const common_1 = require("./common");
// =============================================================================
// Fees - v0.1 is view-only (CSV import by admin, parents see balance)
// Payment processing arrives in v0.2.
// =============================================================================
// Money is stored as Decimal in the DB. On the wire we use strings to avoid
// JS float pitfalls. Validate as a numeric string.
exports.MoneyAmount = zod_1.z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/, { message: 'Must be a number with up to 2 decimal places' });
exports.UpsertFeeBalanceInput = zod_1.z.object({
    studentId: common_1.Uuid,
    termId: common_1.Uuid.optional(),
    amountDue: exports.MoneyAmount,
    amountPaid: exports.MoneyAmount.default('0'),
    currency: zod_1.z.string().length(3).default('KES'),
    notes: zod_1.z.string().max(500).optional(),
    asOfDate: common_1.IsoDate.optional(),
});
// CSV bulk-import row format.
exports.FeeBalanceCsvRow = zod_1.z.object({
    admissionNo: zod_1.z.string().min(1),
    amountDue: exports.MoneyAmount,
    amountPaid: exports.MoneyAmount.default('0'),
    termName: zod_1.z.string().optional(),
    notes: zod_1.z.string().optional(),
});
