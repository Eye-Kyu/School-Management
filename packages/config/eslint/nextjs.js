// =============================================================================
// Next.js ESLint config - extends base with Next-specific rules.
// =============================================================================
module.exports = {
  extends: [
    require.resolve('./base.js'),
    'next/core-web-vitals',
  ],
  rules: {
    // Allow default exports in Next.js (required for page/layout files).
    'import/no-default-export': 'off',
  },
};
