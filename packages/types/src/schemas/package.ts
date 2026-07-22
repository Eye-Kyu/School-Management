import { z } from 'zod';

// =============================================================================
// Package schemas
// =============================================================================
// Pricing tiers + which modules they entitle a school to. Purely data at
// this phase — not yet wired into actual entitlement enforcement (that's a
// later phase: package entitlements + school overrides = effective modules).
// =============================================================================

export const BillingCycle = z.enum(['MONTHLY', 'ANNUAL']);
export type BillingCycle = z.infer<typeof BillingCycle>;

export const PackageModuleEntitlement = z.enum(['INCLUDED', 'OPTIONAL_ADD_ON']);
export type PackageModuleEntitlement = z.infer<typeof PackageModuleEntitlement>;

export const CreatePackageInput = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(1000).optional(),
  price: z.number().min(0),
  currency: z.string().min(3).max(3).default('KES'),
  billingCycle: BillingCycle.default('MONTHLY'),
  displayOrder: z.number().int().default(0),
});
export type CreatePackageInput = z.infer<typeof CreatePackageInput>;

export const UpdatePackageInput = CreatePackageInput.partial().extend({
  isActive: z.boolean().optional(),
});
export type UpdatePackageInput = z.infer<typeof UpdatePackageInput>;

export const SetPackageModulesInput = z.object({
  modules: z.array(z.object({
    moduleKey: z.string(),
    entitlement: PackageModuleEntitlement,
  })),
});
export type SetPackageModulesInput = z.infer<typeof SetPackageModulesInput>;

export const AssignSubscriptionInput = z.object({
  packageId: z.string().uuid(),
  // Modules to keep enabled via an explicit school_modules override even
  // though the new package doesn't include them ("convert to add-on").
  preserveModuleKeys: z.array(z.string()).default([]),
});
export type AssignSubscriptionInput = z.infer<typeof AssignSubscriptionInput>;
