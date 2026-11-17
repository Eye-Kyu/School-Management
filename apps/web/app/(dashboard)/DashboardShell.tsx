'use client';

import { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import LogoutButton from './LogoutButton';
import AvatarDropdown from '@/components/AvatarDropdown';
import { apiFetch } from '@/lib/api';
import { useModuleAccess } from '@/lib/hooks/useModuleAccess';

type NavItem = { href: string; label: string; badgeKey?: string; moduleKey?: string };

const NAV: Record<string, NavItem[]> = {
  ADMIN: [
    { href: '/admin',               label: 'Dashboard' },
    { href: '/admin/teachers',      label: 'Teachers' },
    { href: '/admin/departments',   label: 'Departments' },
    { href: '/admin/students',      label: 'Students' },
    { href: '/admin/parents',       label: 'Parents' },
    { href: '/admin/classes',       label: 'Classes' },
    { href: '/admin/subjects',      label: 'Subjects' },
    { href: '/admin/terms',         label: 'Terms' },
    { href: '/admin/timetable',     label: 'Timetable' },
    { href: '/admin/fees',          label: 'Fees' },
    { href: '/admin/attendance',    label: 'Attendance' },
    { href: '/admin/announcements', label: 'Announcements' },
    { href: '/admin/events',        label: 'Events', moduleKey: 'events' },
    { href: '/admin/messages',      label: 'Messages' },
    { href: '/admin/documents',       label: 'Documents', moduleKey: 'document_library' },
    { href: '/admin/report-cards',    label: 'Report Cards', moduleKey: 'assessments' },
    { href: '/admin/analytics',       label: 'Analytics' },
    { href: '/admin/behaviour',       label: 'Behaviour', moduleKey: 'behaviour_tracking' },
    { href: '/admin/prefects',        label: 'Prefects' },
    { href: '/admin/prefect-powers',  label: 'Prefect Powers' },
    { href: '/admin/absence-requests', label: 'Absence Requests' },
    { href: '/leaderboard',           label: 'Leaderboard', moduleKey: 'behaviour_tracking' },
    { href: '/admin/permission-slips',label: 'Permission Slips', moduleKey: 'permission_slips' },
    { href: '/admin/safety-tips',     label: 'Safety Tips', moduleKey: 'safety_tipline' },
    { href: '/admin/substitutes',     label: 'Substitutes', moduleKey: 'substitute_management' },
    { href: '/admin/compliance',      label: 'Compliance & API', moduleKey: 'compliance_api' },
    { href: '/admin/payments',        label: 'Payments', moduleKey: 'payments' },
    { href: '/admin/setup',           label: 'Setup checklist' },
  ],
  TEACHER: [
    { href: '/teacher',             label: 'Dashboard' },
    { href: '/teacher/schedule',    label: 'Schedule' },
    { href: '/teacher/attendance',  label: 'Attendance' },
    { href: '/teacher/assessments', label: 'Assessments', moduleKey: 'assessments' },
    { href: '/teacher/homework',    label: 'Homework', moduleKey: 'homework' },
    { href: '/teacher/assignments',  label: 'Assignments' },
    { href: '/teacher/quizzes',     label: 'Quizzes', moduleKey: 'quizzes' },
    { href: '/teacher/gradebook',   label: 'Gradebook', moduleKey: 'assessments' },
    { href: '/teacher/analytics',   label: 'Analytics' },
    { href: '/teacher/behaviour',   label: 'Behaviour', moduleKey: 'behaviour_tracking' },
    { href: '/teacher/behavior-incidents', label: 'Incident Reports' },
    { href: '/teacher/attendance-remarks', label: 'Attendance Re-marking' },
    { href: '/teacher/absence-requests', label: 'Absence Requests' },
    { href: '/leaderboard',         label: 'Leaderboard', moduleKey: 'behaviour_tracking' },
    { href: '/teacher/permission-slips', label: 'Permission Slips', moduleKey: 'permission_slips' },
    { href: '/documents',           label: 'Documents', moduleKey: 'document_library' },
    { href: '/messages',            label: 'Messages', badgeKey: 'messages' },
  ],
  STUDENT: [
    { href: '/student',             label: 'Dashboard' },
    { href: '/student/timetable',   label: 'Timetable' },
    { href: '/student/grades',      label: 'Grades' },
    { href: '/student/attendance',  label: 'Attendance' },
    { href: '/student/homework',    label: 'Homework', moduleKey: 'homework' },
    { href: '/student/assignments', label: 'Assignments' },
    { href: '/student/quizzes',     label: 'Quizzes', moduleKey: 'quizzes' },
    { href: '/student/analytics',   label: 'Analytics' },
    { href: '/leaderboard',         label: 'Leaderboard', moduleKey: 'behaviour_tracking' },
    { href: '/documents',           label: 'Documents', moduleKey: 'document_library' },
    { href: '/student/tutor',       label: 'AI Tutor', moduleKey: 'ai_tutor' },
  ],
  PARENT: [
    { href: '/parent',              label: 'Dashboard' },
    { href: '/parent/timetable',    label: 'Timetable' },
    { href: '/parent/grades',       label: 'Grades' },
    { href: '/parent/attendance',   label: 'Attendance' },
    { href: '/parent/absence-requests', label: 'Absence Requests' },
    { href: '/parent/fees',         label: 'Fees' },
    { href: '/parent/homework',           label: 'Homework', moduleKey: 'homework' },
    { href: '/parent/permission-slips',   label: 'Permission Slips', moduleKey: 'permission_slips' },
    { href: '/leaderboard',               label: 'Leaderboard', moduleKey: 'behaviour_tracking' },
    { href: '/documents',           label: 'Documents', moduleKey: 'document_library' },
    { href: '/messages',            label: 'Messages', badgeKey: 'messages' },
  ],
  SUPER_ADMIN: [
    { href: '/super-admin', label: 'Schools' },
  ],
};

// Admin has ~28 destinations: grouped so the sidebar scans in sections.
// Grouping is presentation only; every href, label and module gate above is unchanged.
const ADMIN_GROUPS: { title: string; hrefs: string[] }[] = [
  { title: 'Overview', hrefs: ['/admin', '/admin/analytics', '/admin/setup'] },
  { title: 'People', hrefs: ['/admin/teachers', '/admin/departments', '/admin/students', '/admin/parents', '/admin/prefects', '/admin/prefect-powers', '/admin/substitutes'] },
  { title: 'Teaching', hrefs: ['/admin/classes', '/admin/subjects', '/admin/terms', '/admin/timetable', '/admin/report-cards'] },
  { title: 'Day to day', hrefs: ['/admin/attendance', '/admin/absence-requests', '/admin/behaviour', '/leaderboard', '/admin/permission-slips', '/admin/safety-tips'] },
  { title: 'Money', hrefs: ['/admin/fees', '/admin/payments'] },
  { title: 'Messages', hrefs: ['/admin/announcements', '/admin/events', '/admin/messages', '/admin/documents', '/admin/compliance'] },
];

function NavLink({
  href, label, active, onClick, badge,
}: NavItem & { active: boolean; onClick?: () => void; badge?: number }) {
  return (
    <Link
      href={href}
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className="nav-link"
    >
      <span className="truncate">{label}</span>
      {badge ? (
        <span className="nav-badge tabular" aria-label={`${badge} unread`}>
          {badge > 99 ? '99+' : badge}
        </span>
      ) : null}
    </Link>
  );
}

const ROLE_LABEL: Record<string, string> = {
  ADMIN: 'Admin',
  TEACHER: 'Teacher',
  STUDENT: 'Student',
  PARENT: 'Parent',
  SUPER_ADMIN: 'Platform',
};

export default function DashboardShell({
  role,
  displayName,
  avatarUrl,
  children,
}: {
  role: string;
  displayName: string;
  avatarUrl?: string | null;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [msgUnread, setMsgUnread] = useState(0);
  const { isModuleEnabled } = useModuleAccess();

  useEffect(() => {
    if (role === 'TEACHER' || role === 'PARENT') {
      apiFetch<{ count: number }>('/messaging/unread-count')
        .then((r) => setMsgUnread(r.count))
        .catch(() => {});
    }
  }, [role, pathname]);

  // Escape closes the mobile drawer.
  useEffect(() => {
    if (!sidebarOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSidebarOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [sidebarOpen]);

  const links = (NAV[role] ?? [])
    .filter((link) => !link.moduleKey || isModuleEnabled(link.moduleKey))
    .map((link) =>
      link.badgeKey === 'messages' ? { ...link, badge: msgUnread || undefined } : link,
    );
  const close = () => setSidebarOpen(false);

  const renderLink = (link: NavItem & { badge?: number }) => (
    <NavLink
      key={link.href}
      href={link.href}
      label={link.label}
      badge={link.badge}
      active={pathname === link.href}
      onClick={close}
    />
  );

  // Admin: sectioned. Every other role: one short list.
  const sections =
    role === 'ADMIN'
      ? ADMIN_GROUPS.map((g) => ({
          title: g.title,
          items: g.hrefs
            .map((h) => links.find((l) => l.href === h))
            .filter((l): l is NavItem & { badge?: number } => Boolean(l)),
        }))
          .concat([{
            title: 'More',
            items: links.filter((l) => !ADMIN_GROUPS.some((g) => g.hrefs.includes(l.href))),
          }])
          .filter((g) => g.items.length > 0)
      : [{ title: '', items: links }];

  return (
    <div data-role={role.toLowerCase() || undefined} className="min-h-screen flex flex-col">
      {/* Top bar */}
      <header className="shell-bar h-14 px-4 flex items-center justify-between sticky top-0 z-30 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          {/* Mobile menu */}
          <button
            type="button"
            className="sm:hidden -ml-1 h-10 w-10 inline-flex items-center justify-center rounded-shell text-slate-600 hover:bg-slate-100 transition-colors"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open menu"
            aria-expanded={sidebarOpen}
            aria-controls="dashboard-nav"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <Link href={NAV[role]?.[0]?.href ?? '/'} className="shell-wordmark" aria-label="School Manager, home">
            School Manager
          </Link>
          {role && (
            <span className="shell-role hidden sm:inline-flex">{ROLE_LABEL[role] ?? role.toLowerCase()}</span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-slate-600 hidden sm:block truncate max-w-[160px]">{displayName}</span>
          <AvatarDropdown name={displayName} avatarUrl={avatarUrl} role={role} />
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        {/* Mobile backdrop */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 z-40 bg-slate-950/40 sm:hidden"
            onClick={close}
          />
        )}

        {/* Sidebar */}
        <aside
          id="dashboard-nav"
          className={`
            shell-side w-60 flex flex-col shrink-0
            fixed top-14 bottom-0 left-0 z-40 transition-transform duration-200
            sm:sticky sm:top-14 sm:h-[calc(100vh-3.5rem)] sm:translate-x-0
            ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
          `}
        >
          <nav aria-label="Main" className="flex-1 overflow-y-auto px-3 py-4 space-y-4">
            {sections.map((section) => (
              <div key={section.title || 'main'} className="space-y-0.5">
                {section.title && <p className="nav-group">{section.title}</p>}
                {section.items.map(renderLink)}
              </div>
            ))}
          </nav>

          <div className="border-t border-slate-200 px-3 py-3 space-y-0.5">
            <NavLink
              href="/profile"
              label="My Profile"
              active={pathname === '/profile'}
              onClick={close}
            />
            <div className="px-3 py-2">
              <LogoutButton />
            </div>
          </div>
        </aside>

        {/* Main content */}
        <main className="flex-1 min-w-0 px-4 py-6 sm:px-8 sm:py-8">
          <div className="mx-auto w-full max-w-7xl">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
