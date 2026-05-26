const { withPostHogConfig } = require('@posthog/nextjs-config');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Shared workspace packages need to be transpiled by Next.
  transpilePackages: ['@school-manager/types', '@school-manager/ui'],
  experimental: {
    serverActions: { bodySizeLimit: '2mb' },
  },
};

// Wrap with PostHog (adds /ingest rewrites automatically)
// Source map uploading requires a PostHog project ID + personal API key — disabled here.
const withPostHog = withPostHogConfig(nextConfig, {
  host: 'https://eu.i.posthog.com',
  sourcemaps: { enabled: false },
});

// Wrap with Sentry only when DSN is configured to avoid build noise in local dev.
const { withSentryConfig } = require('@sentry/nextjs');
module.exports = process.env.NEXT_PUBLIC_SENTRY_DSN
  ? withSentryConfig(withPostHog, { silent: true, hideSourceMaps: true, disableLogger: true })
  : withPostHog;
