'use client';

// =============================================================================
// SuperAdminShell - dedicated chrome for the platform control-plane
// =============================================================================
// Deliberately separate from apps/web/app/(dashboard)/DashboardShell.tsx.
// The target IA here (grouped, permission-filtered nav across Platform
// Administration / Platform Intelligence / Security & Access) is materially
// different from the tenant dashboards' flat single-level nav, so this keeps
// zero risk to ADMIN/TEACHER/STUDENT/PARENT while iterating on this shell.
// =============================================================================

import { useCallback, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import LogoutButton from '../(dashboard)/LogoutButton';
import AvatarDropdown from '@/components/AvatarDropdown';
import { usePlatformPermissions } from '@/lib/hooks/usePlatformPermissions';
import { apiFetch } from '@/lib/api';
import {
  PRIVILEGED_ACCESS_CHANGED_EVENT,
  notifyPrivilegedAccessChanged,
  formatRemaining,
  type PrivilegedAccessGrant,
} from '@/lib/privilegedAccess';
import type { PlatformPermission } from '@school-manager/types';

type NavItem = { href: string; label: string; permissionKey?: PlatformPermission };
type NavGroup = { heading: string; items: NavItem[] };

const NAV_GROUPS: NavGroup[] = [
  {
    heading: 'Platform Intelligence',
    items: [
      { href: '/super-admin', label: 'Dashboard' },
      { href: '/super-admin/analytics', label: 'Analytics', permissionKey: 'VIEW_PLATFORM_ANALYTICS' },
    ],
  },
  {
    heading: 'Platform Administration',
    items: [
      { href: '/super-admin/schools', label: 'Schools', permissionKey: 'VIEW_SCHOOLS' },
      { href: '/super-admin/packages', label: 'Packages & Plans', permissionKey: 'VIEW_PACKAGES' },
      { href: '/super-admin/modules', label: 'Modules', permissionKey: 'VIEW_MODULES' },
      { href: '/super-admin/curriculum', label: 'Curriculum', permissionKey: 'VIEW_CURRICULUM' },
      { href: '/super-admin/users', label: 'Users', permissionKey: 'VIEW_PLATFORM_USERS' },
      { href: '/super-admin/billing', label: 'Billing', permissionKey: 'VIEW_BILLING' },
      { href: '/super-admin/messages', label: 'Messages', permissionKey: 'SEND_PLATFORM_MESSAGES' },
    ],
  },
  {
    heading: 'Security & Access',
    items: [
      { href: '/super-admin/audit', label: 'Audit & Security', permissionKey: 'VIEW_AUDIT_LOGS' },
      { href: '/super-admin/system-health', label: 'System Health', permissionKey: 'VIEW_SYSTEM_HEALTH' },
    ],
  },
];

function NavLink({ href, label, active, onClick }: NavItem & { active: boolean; onClick?: () => void }) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className={`block rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
        active
          ? 'bg-slate-900 text-white'
          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
      }`}
    >
      {label}
    </Link>
  );
}

export default function SuperAdminShell({
  displayName,
  avatarUrl,
  children,
}: {
  displayName: string;
  avatarUrl?: string | null;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { hasPermission } = usePlatformPermissions();
  const close = () => setSidebarOpen(false);

  const [activeGrant, setActiveGrant] = useState<PrivilegedAccessGrant | null>(null);
  const [endingGrant, setEndingGrant] = useState(false);
  const [, forceTick] = useState(0);

  const loadActiveGrant = useCallback(() => {
    apiFetch<PrivilegedAccessGrant | null>('/super-admin/privileged-access/grants/active')
      .then(setActiveGrant)
      .catch(() => setActiveGrant(null));
  }, []);

  useEffect(() => {
    loadActiveGrant();
    const onChange = () => loadActiveGrant();
    window.addEventListener(PRIVILEGED_ACCESS_CHANGED_EVENT, onChange);
    const pollId = setInterval(loadActiveGrant, 30000);
    const tickId = setInterval(() => forceTick((n) => n + 1), 30000);
    return () => {
      window.removeEventListener(PRIVILEGED_ACCESS_CHANGED_EVENT, onChange);
      clearInterval(pollId);
      clearInterval(tickId);
    };
  }, [loadActiveGrant]);

  async function endSession() {
    if (!activeGrant) return;
    if (!confirm('End this privileged access session now?')) return;
    setEndingGrant(true);
    try {
      await apiFetch(`/super-admin/privileged-access/grants/${activeGrant.id}/end`, { method: 'POST' });
      setActiveGrant(null);
      notifyPrivilegedAccessChanged();
    } catch {
      // best-effort — the next poll reconciles either way
    } finally {
      setEndingGrant(false);
    }
  }

  // Tailwind's content scanner needs complete literal class strings — these
  // stay as static ternaries (never template-interpolated) so both the
  // "banner shown" and "no banner" variants are statically discoverable.
  const bannerVisible = !!activeGrant;
  const headerTopClass = bannerVisible ? 'top-9' : 'top-0';
  const asideMobileTopClass = bannerVisible ? 'top-[5.75rem]' : 'top-14';
  const asideDesktopHeightClass = bannerVisible ? 'sm:h-[calc(100vh-5.75rem)]' : 'sm:h-[calc(100vh-3.5rem)]';

  const visibleGroups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => !item.permissionKey || hasPermission(item.permissionKey)),
  })).filter((group) => group.items.length > 0);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {activeGrant && (
        <div className="h-9 bg-amber-500 text-amber-950 sticky top-0 z-40 flex items-center justify-between gap-3 px-4 text-xs font-semibold shrink-0">
          <span className="truncate">
            ⚠ PRIVILEGED PLATFORM ACCESS — Viewing{' '}
            <Link href={`/super-admin/privileged-access/${activeGrant.id}`} className="underline">
              {activeGrant.schoolName ?? 'a school'}
            </Link>{' '}
            — expires in {formatRemaining(activeGrant.expiresAt)}
          </span>
          <button
            onClick={endSession}
            disabled={endingGrant}
            className="px-2.5 py-1 rounded-md bg-amber-950 text-amber-50 font-semibold hover:bg-amber-900 disabled:opacity-50 shrink-0"
          >
            {endingGrant ? '…' : 'End session'}
          </button>
        </div>
      )}

      {/* Top header */}
      <header className={`bg-white border-b border-slate-200 h-14 px-4 flex items-center justify-between sticky ${headerTopClass} z-30 shrink-0`}>
        <div className="flex items-center gap-3">
          <button
            className="sm:hidden p-1.5 rounded-md text-slate-500 hover:bg-slate-100 transition-colors"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open menu"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <span className="font-semibold text-slate-800">School Manager</span>
          <span className="hidden sm:inline text-xs font-medium uppercase tracking-wide bg-violet-100 text-violet-700 px-2 py-0.5 rounded">
            Control Plane
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-slate-500 hidden sm:block truncate max-w-[140px]">{displayName}</span>
          <AvatarDropdown name={displayName} avatarUrl={avatarUrl} role="SUPER_ADMIN" />
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        {sidebarOpen && (
          <div className="fixed inset-0 z-40 bg-black/40 sm:hidden" onClick={close} />
        )}

        <aside
          className={`
            w-60 bg-white border-r border-slate-200 flex flex-col shrink-0
            fixed ${asideMobileTopClass} bottom-0 left-0 z-40 transition-transform duration-200
            sm:sticky sm:top-0 ${asideDesktopHeightClass} sm:translate-x-0
            ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
          `}
        >
          <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-4">
            {visibleGroups.map((group) => (
              <div key={group.heading}>
                <p className="px-3 mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  {group.heading}
                </p>
                <div className="space-y-0.5">
                  {group.items.map((item) => (
                    <NavLink
                      key={item.href}
                      href={item.href}
                      label={item.label}
                      active={pathname === item.href}
                      onClick={close}
                    />
                  ))}
                </div>
              </div>
            ))}
          </nav>

          <div className="border-t border-slate-100 px-3 py-3 space-y-0.5">
            <NavLink href="/profile" label="My Profile" active={pathname === '/profile'} onClick={close} />
            <div className="px-3 py-2">
              <LogoutButton />
            </div>
          </div>
        </aside>

        <main className="flex-1 min-w-0 p-6">{children}</main>
      </div>
    </div>
  );
}
