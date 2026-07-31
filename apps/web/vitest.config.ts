import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    passWithNoTests: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  // Next.js transforms JSX itself (SWC) — tsconfig's "jsx": "preserve"
  // reflects that. Vitest runs through esbuild instead, a separate
  // pipeline, so it needs its own explicit JSX runtime config or .tsx
  // component tests fail at runtime with "React is not defined".
  esbuild: {
    jsx: 'automatic',
  },
});
