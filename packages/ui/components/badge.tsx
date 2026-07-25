import * as React from 'react';
import { cn } from '../src/lib/cn';

// Hand-authored to match shadcn/ui's Badge API and styling (same className
// shape, same `variant` prop) without pulling in `class-variance-authority` —
// this repo's `cn()` helper is a plain string-joiner (see src/lib/cn.ts), not
// a tailwind-merge wrapper, so variants are listed as plain className strings
// instead of a cva() config. Swap to the real shadcn source later if/when
// `class-variance-authority` + `tailwind-merge` are added as deps; the public
// API here is deliberately identical so that swap is a no-op for consumers.
export const BADGE_VARIANTS = {
  default: 'border-transparent bg-slate-900 text-white',
  secondary: 'border-transparent bg-slate-100 text-slate-700',
  destructive: 'border-transparent bg-rose-600 text-white',
  outline: 'border-slate-300 text-slate-700',
  // Muted, role-differentiated variants — same visual weight as this app's
  // existing amber "Prefect" tag, not bright/alarming colors.
  classTeacher: 'border-indigo-200 bg-indigo-100 text-indigo-700',
  departmentHead: 'border-sky-200 bg-sky-100 text-sky-700',
  classPrefect: 'border-amber-200 bg-amber-100 text-amber-700',
  schoolPrefect: 'border-violet-200 bg-violet-100 text-violet-700',
  // Matches the existing "From platform team" tag on /notifications/platform
  // (PlatformMessagesClient.tsx) — same violet tone, different semantic key
  // since it isn't a role badge.
  platformMessage: 'border-violet-200 bg-violet-100 text-violet-700',
} as const;

export type BadgeVariant = keyof typeof BADGE_VARIANTS;

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

export function Badge({ className, variant = 'default', ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors',
        BADGE_VARIANTS[variant],
        className,
      )}
      {...props}
    />
  );
}
