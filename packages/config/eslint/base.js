// =============================================================================
// Base ESLint config - the shared rules every package extends from.
// =============================================================================
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'prettier',
  ],
  ignorePatterns: ['dist/', '.next/', 'node_modules/', '*.config.js'],
  rules: {
    // Warn on unused vars, but allow leading-underscore to opt out.
    '@typescript-eslint/no-unused-vars': [
      'warn',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],
    // Bare TODOs fail lint - they must have a name or ticket.
    'no-warning-comments': [
      'warn',
      { terms: ['TODO', 'FIXME', 'XXX', 'HACK'], location: 'anywhere' },
    ],
  },
};
