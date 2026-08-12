const { withPostHogConfig } = require('@posthog/nextjs-config');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@school-manager/types', '@school-manager/ui'],
  experimental: {
    serverActions: { bodySizeLimit: '2mb' },
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '*.supabase.co', pathname: '/storage/v1/object/public/**' },
      { protocol: 'https', hostname: 'api.dicebear.com' },
    ],
  },
  // Proxies PostHog ingestion through this app's own domain, so client
  // requests aren't blocked by ad-blockers/ISP-level third-party-analytics
  // blocking. NOT provided by withPostHogConfig below — that wrapper only
  // handles build-time source-map upload (confirmed by reading its source,
  // @posthog/nextjs-config's dist/config.js — it never touches routing).
  // This was previously assumed to be automatic and wasn't actually here at
  // all; PostHogProvider.tsx's api_host: '/ingest' had nothing to route to.
  // See docs/audits/posthog-capture-audit.md.
  async rewrites() {
    return [
      { source: '/ingest/static/:path*', destination: 'https://eu-assets.i.posthog.com/static/:path*' },
      { source: '/ingest/:path*', destination: 'https://eu.i.posthog.com/:path*' },
    ];
  },
  skipTrailingSlashRedirect: true,
};

// Wrap with Sentry only when DSN is configured to avoid build noise in local dev.
const { withSentryConfig } = require('@sentry/nextjs');
const sentryWrapped = process.env.NEXT_PUBLIC_SENTRY_DSN
  ? withSentryConfig(nextConfig, { silent: true, hideSourceMaps: true, disableLogger: true })
  : nextConfig;

// withPostHogConfig must be the OUTERMOST wrapper — its own runtime warning
// says another wrapper (it names withSentryConfig as an example) can produce
// a plain object that drops its hooks. Previously wrapped in the opposite
// order (Sentry outermost); no observed practical effect yet since
// sourcemaps are disabled below, but fixed while already touching this file
// for the rewrite, before it becomes a real bug when sourcemaps are enabled.
// Source map uploading requires a PostHog project ID + personal API key — disabled here.
module.exports = withPostHogConfig(sentryWrapped, {
  host: 'https://eu.i.posthog.com',
  sourcemaps: { enabled: false },
});
