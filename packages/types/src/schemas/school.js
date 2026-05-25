"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UpdateSchoolInput = exports.CreateSchoolInput = void 0;
const zod_1 = require("zod");
const common_1 = require("./common");
// =============================================================================
// School schemas
// =============================================================================
// The school is the tenant. Only the platform admin creates schools;
// school admins update their own school's profile.
// =============================================================================
exports.CreateSchoolInput = zod_1.z.object({
    name: zod_1.z.string().min(2).max(200),
    // slug is used as subdomain - lowercase letters, digits, hyphens
    slug: zod_1.z
        .string()
        .min(3)
        .max(50)
        .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, {
        message: 'Slug must be lowercase letters, digits, and hyphens',
    }),
    phone: common_1.PhoneNumber.optional(),
    email: zod_1.z.string().email().optional(),
    address: zod_1.z.string().max(500).optional(),
    timezone: zod_1.z.string().default('Africa/Nairobi'),
});
exports.UpdateSchoolInput = exports.CreateSchoolInput.partial().omit({ slug: true });
