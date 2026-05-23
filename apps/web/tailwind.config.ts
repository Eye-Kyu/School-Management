import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    '../../packages/ui/src/**/*.{ts,tsx}',
    '../../packages/ui/components/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      // Theme tokens go here once a designer is involved.
    },
  },
  plugins: [],
};
export default config;
