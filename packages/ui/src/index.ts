// =============================================================================
// @school-manager/ui - shared component library
// =============================================================================
// shadcn/ui components are added by running, from any consuming app:
//
//   pnpm dlx shadcn@latest add button
//   pnpm dlx shadcn@latest add input
//   pnpm dlx shadcn@latest add dialog
//
// Move them under packages/ui/components/ and re-export from here so apps
// can import via:  import { Button } from '@school-manager/ui';
//
// Why a package and not duplicated per app?
//   - One copy of the button, used in admin / teacher / student / parent UIs.
//   - Brand-consistent across roles.
//   - Easy to add Storybook later when there's a designer to review.
// =============================================================================

// Example re-export (uncomment after running `shadcn add button`):
// export { Button } from '../components/button';

export { Badge, BADGE_VARIANTS, type BadgeProps, type BadgeVariant } from '../components/badge';

// Utility re-exports - the `cn` className helper that shadcn uses everywhere.
export { cn } from './lib/cn';
