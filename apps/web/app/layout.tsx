import './globals.css';
import * as Sentry from '@sentry/nextjs';
import type { Metadata, Viewport } from 'next';

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
      <body>{children}</body>
    </html>
  );
}
