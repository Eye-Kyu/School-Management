// =============================================================================
// NestJS ESLint config - extends base with Nest-specific allowances.
// =============================================================================
module.exports = {
  extends: [require.resolve('./base.js')],
  rules: {
    // NestJS uses decorators with empty constructors for DI.
    '@typescript-eslint/no-empty-function': ['warn', { allow: ['constructors'] }],
    // Decorators trigger this falsely on metadata-only injections.
    '@typescript-eslint/no-unused-vars': [
      'warn',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
    ],
  },
};
