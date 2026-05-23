'use client';

import { useRouter } from 'next/navigation';

export default function BackButton({ href, label = 'Back' }: { href?: string; label?: string }) {
  const router = useRouter();
  return (
    <button
      onClick={() => (href ? router.push(href) : router.back())}
      className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900
                 transition-colors group"
    >
      <span className="group-hover:-translate-x-0.5 transition-transform">←</span>
      {label}
    </button>
  );
}
