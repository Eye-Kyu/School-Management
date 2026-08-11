// =============================================================================
// Next.js ESLint config - extends base with Next-specific rules.
// =============================================================================

// jsx-a11y's recommended ruleset, downgraded from 'error' to 'warn' — same
// treatment as @typescript-eslint/no-explicit-any below. Enabling it at
// 'error' would fail CI across the ~149 .tsx files that predate this rule
// (only 15 pages have had a real accessibility pass so far, per Phase 0
// sub-sprint 4 — docs/audits/accessibility-follow-ups.md). 'warn' makes the
// full ruleset explicit and CI-visible (the closest realistic proxy for
// "every new screen passes axe DevTools before merge" this environment has,
// since no real browser/axe tooling is available to actually run it) without
// blocking merges on pre-existing debt outside this PR's scope.
const jsxA11yRecommended = require('eslint-plugin-jsx-a11y').configs.recommended;
const jsxA11yWarnings = Object.fromEntries(
  Object.entries(jsxA11yRecommended.rules)
    .filter(([, severity]) => severity !== 'off') // don't re-enable rules the preset itself disables (e.g. label-has-for, superseded by label-has-associated-control)
    .map(([rule]) => [rule, 'warn']),
);

module.exports = {
  extends: [
    require.resolve('./base.js'),
    'next/core-web-vitals',
  ],
  plugins: ['jsx-a11y'],
  rules: {
    ...jsxA11yWarnings,
    // Allow default exports in Next.js (required for page/layout files).
    'import/no-default-export': 'off',
    // API response types often require `any`; warn instead of failing CI.
    '@typescript-eslint/no-explicit-any': 'warn',
    // Too strict for JSX prose text (apostrophes in labels/messages).
    'react/no-unescaped-entities': 'off',
  },
};
