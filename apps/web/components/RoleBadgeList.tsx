import Link from 'next/link';
import { Badge } from '@school-manager/ui';
import type { RoleBadge } from '@/lib/roleBadges';

export default function RoleBadgeList({ badges, className }: { badges: RoleBadge[]; className?: string }) {
  if (badges.length === 0) return null;
  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className ?? ''}`}>
      {badges.map((b) =>
        b.href ? (
          <Link key={b.label} href={b.href}>
            <Badge variant={b.variant}>{b.label}</Badge>
          </Link>
        ) : (
          <Badge key={b.label} variant={b.variant}>{b.label}</Badge>
        ),
      )}
    </div>
  );
}
