module.exports = {
  extends: [require.resolve('@school-manager/config/eslint/nestjs')],
  parserOptions: {
    project: './tsconfig.json',
    tsconfigRootDir: __dirname,
  },
};
