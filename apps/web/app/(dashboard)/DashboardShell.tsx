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
    { href: '/leaderboard',         label: 'Leaderboard', moduleKey: 'behaviour_tracking' },
    { href: '/teacher/permission-slips', label: 'Permission Slips', moduleKey: 'permission_slips' },
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
    { href: '/student/tutor',       label: '✨ AI Tutor', moduleKey: 'ai_features' },
  ],
  PARENT: [
    { href: '/parent',              label: 'Dashboard' },
    { href: '/parent/timetable',    label: 'Timetable' },
    { href: '/parent/grades',       label: 'Grades' },
    { href: '/parent/attendance',   label: 'Attendance' },
    { href: '/parent/fees',         label: 'Fees' },
    { href: '/parent/homework',           label: 'Homework', moduleKey: 'homework' },
    { href: '/parent/permission-slips',   label: 'Permission Slips', moduleKey: 'permission_slips' },
    { href: '/leaderboard',               label: 'Leaderboard', moduleKey: 'behaviour_tracking' },
    { href: '/messages',            label: 'Messages', badgeKey: 'messages' },
  ],
  SUPER_ADMIN: [
    { href: '/super-admin', label: 'Schools' },
  ],
};

function NavLink({
  href, label, active, onClick, badge,
}: NavItem & { active: boolean; onClick?: () => void; badge?: number }) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
        active
          ? 'bg-slate-900 text-white'
          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
      }`}
    >
      {label}
      {badge ? (
        <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
          {badge > 99 ? '99+' : badge}
        </span>
      ) : null}
    </Link>
  );
}

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

  const links = (NAV[role] ?? [])
    .filter((link) => !link.moduleKey || isModuleEnabled(link.moduleKey))
    .map((link) =>
      link.badgeKey === 'messages' ? { ...link, badge: msgUnread || undefined } : link,
    );
  const close = () => setSidebarOpen(false);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Top header */}
      <header className="bg-white border-b border-slate-200 h-14 px-4 flex items-center justify-between sticky top-0 z-30 shrink-0">
        <div className="flex items-center gap-3">
          {/* Mobile hamburger */}
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
          {role && (
            <span className="hidden sm:inline text-xs font-medium uppercase tracking-wide bg-slate-100 text-slate-500 px-2 py-0.5 rounded">
              {role.toLowerCase()}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-slate-500 hidden sm:block truncate max-w-[140px]">{displayName}</span>
          <AvatarDropdown name={displayName} avatarUrl={avatarUrl} role={role} />
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        {/* Mobile backdrop */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 z-40 bg-black/40 sm:hidden"
            onClick={close}
          />
        )}

        {/* Sidebar */}
        <aside
          className={`
            w-56 bg-white border-r border-slate-200 flex flex-col shrink-0
            fixed top-14 bottom-0 left-0 z-40 transition-transform duration-200
            sm:sticky sm:top-0 sm:h-[calc(100vh-3.5rem)] sm:translate-x-0
            ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
          `}
        >
          <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-0.5">
            {links.map((link) => (
              <NavLink
                key={link.href}
                href={link.href}
                label={link.label}
                active={pathname === link.href}
                onClick={close}
              />
            ))}
          </nav>

          <div className="border-t border-slate-100 px-3 py-3 space-y-0.5">
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
        <main className="flex-1 min-w-0 p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
