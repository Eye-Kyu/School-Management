import type { Config } from 'tailwindcss';

// Every colour family the app uses resolves to a token in styles/roles.css,
// so each role's dial (data-role on the dashboard shell) re-skins every page.
const STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;
const scale = (prefix: string) =>
  Object.fromEntries(STEPS.map((s) => [s, `oklch(var(--${prefix}-${s}) / <alpha-value>)`]));

const ink = scale('k');
const accent = scale('a');
const good = scale('g');
const watch = scale('w');
const alert = scale('r');

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    '../../packages/ui/src/**/*.{ts,tsx}',
    '../../packages/ui/components/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        white: 'oklch(var(--k-card) / <alpha-value>)',
        slate: ink, gray: ink, zinc: ink, neutral: ink, stone: ink,
        violet: accent, purple: accent, indigo: accent, blue: accent, sky: accent,
        emerald: good, green: good, teal: good, lime: good,
        amber: watch, yellow: watch, orange: watch,
        rose: alert, red: alert, pink: alert, fuchsia: alert,
        // Hum's named accents, for the redesigned role screens
        paper: 'var(--color-paper)',
        card: 'var(--color-card)',
        ink: 'var(--color-ink)',
        pear: { DEFAULT: 'var(--color-accent)', deep: 'var(--color-accent-deep)' },
        coral: 'var(--color-accent-3)',
        mint: { DEFAULT: 'var(--color-mint)', deep: 'var(--color-mint-deep)' },
        sugar: 'var(--color-sugar)',
        kraft: 'var(--color-kraft)',
        role: { DEFAULT: 'var(--color-role)', soft: 'var(--color-role-soft)', ink: 'var(--color-role-ink)' },
      },
      fontFamily: {
        sans: ['var(--font-body)'],
        display: ['var(--font-display)'],
        mono: ['var(--font-outlier)'],
      },
      borderRadius: {
        shell: 'var(--shell-radius)',
        stock: 'var(--radius-stock)',
      },
      boxShadow: {
        card: 'var(--shadow-card)',
      },
    },
  },
  plugins: [],
};
export default config;
