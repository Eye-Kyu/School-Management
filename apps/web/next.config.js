/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Shared workspace packages need to be transpiled by Next.
  transpilePackages: ['@school-manager/types', '@school-manager/ui'],
  experimental: {
    serverActions: { bodySizeLimit: '2mb' },
  },
};

module.exports = nextConfig;
