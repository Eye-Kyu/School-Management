# @school-manager/config

Shared ESLint and TypeScript configuration.

## TypeScript

Apps extend `tsconfig/base.json`, `tsconfig/nextjs.json`, or `tsconfig/nestjs.json`:

```json
{
  "extends": "../../packages/config/tsconfig/nextjs.json",
  "compilerOptions": {
    "baseUrl": "./",
    "paths": { "@/*": ["./*"] }
  }
}
```

## ESLint

Apps create a `.eslintrc.js` that requires one of the presets:

```js
module.exports = {
  extends: [require.resolve('@school-manager/config/eslint/nextjs')],
};
```

## When to add new presets

When two or more apps need the same config and currently duplicate it.
Don't add presets speculatively - speculative shared config is the
hardest kind to remove later.
