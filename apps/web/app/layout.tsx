import './globals.css';
import * as Sentry from '@sentry/nextjs';
import type { Metadata, Viewport } from 'next';
import { PostHogProvider } from '@/components/PostHogProvider';
import { QueryProvider } from '@/components/QueryProvider';

export function generateMetadata(): Metadata {
  return {
    title: 'School Manager',
    description: 'School management for parents, students, teachers, and admins.',
    manifest: '/manifest.webmanifest',
    other: {
      ...Sentry.getTraceData(),
    },
  };
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0f172a',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Chillax (Hum's face), 500 and 600 only */}
        <link rel="preconnect" href="https://api.fontshare.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link rel="stylesheet" href="https://api.fontshare.com/v2/css?f[]=chillax@500,600&display=swap" />
      </head>
      <body>
        <PostHogProvider>
          <QueryProvider>{children}</QueryProvider>
        </PostHogProvider>
      </body>
    </html>
  );
}
