import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import UpcomingEvents from '@/components/UpcomingEvents';
import { DashboardFeed } from '@/components/DashboardFeed/DashboardFeed';
import DeniedBanner from '@/components/DeniedBanner';

type StatCard = {
  label: string;
  value: string | number;
  sub?: string;
  href: string;
  tone?: string;
};

export default async function AdminHomePage({
  searchParams,
}: {
  searchParams: { denied?: string };
}) {
  const supabase = createClient();

  const { data: { user: authUser } } = await supabase.auth.getUser();
  const { data: userRow } = await supabase.from('users').select('id').eq('auth_id', authUser!.id).maybeSingle();

  const now = new Date().toISOString();
  const in30Days = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  const [
    { count: classCount },
    { count: teacherCount },
    { count: studentCount },
    { count: parentCount },
    { data: feeData },
    { data: events },
  ] = await Promise.all([
    supabase.from('classes').select('*', { count: 'exact', head: true }).eq('is_active', true),
    supabase.from('teachers').select('*', { count: 'exact', head: true }),
    supabase.from('students').select('*', { count: 'exact', head: true }).eq('is_active', true),
    supabase.from('users').select('*', { count: 'exact', head: true }).eq('role', 'PARENT').eq('is_active', true),
    supabase.from('fee_balances').select('amount_due, amount_paid'),
    supabase
      .from('events')
      .select('id, title, starts_at, ends_at, all_day, event_type')
      .gte('starts_at', now)
      .lte('starts_at', in30Days)
      .order('starts_at')
      .limit(10),
  ]);

  const totalOutstanding = (feeData ?? []).reduce(
    (s, b) => s + Number(b.amount_due) - Number(b.amount_paid),
    0,
  );

  const statCards: StatCard[] = [
    {
      label: 'Active classes',
      value: classCount ?? 0,
      href: '/admin/classes',
    },
    {
      label: 'Teachers',
      value: teacherCount ?? 0,
      href: '/admin/teachers',
    },
    {
      label: 'Students',
      value: studentCount ?? 0,
      href: '/admin/students',
    },
    {
      label: 'Parents',
      value: parentCount ?? 0,
      href: '/admin/parents',
    },
    {
      label: 'Fee arrears',
      value: `KES ${totalOutstanding.toLocaleString()}`,
      sub: 'outstanding',
      href: '/admin/fees',
      tone: totalOutstanding > 0 ? 'text-rose-700' : 'text-emerald-700',
    },
  ];

  const setupLinks = [
    { href: '/admin/terms',         label: 'Terms',         desc: 'Create the current academic term' },
    { href: '/admin/classes',       label: 'Classes',       desc: 'Add grade levels and streams' },
    { href: '/admin/subjects',      label: 'Subjects',      desc: 'Define subjects and assign teachers' },
    { href: '/admin/teachers',      label: 'Teachers',      desc: 'Create teacher accounts' },
    { href: '/admin/students',      label: 'Students',      desc: 'Enrol students and link to classes' },
    { href: '/admin/parents',       label: 'Parents',       desc: 'Create parent accounts and link children' },
    { href: '/admin/timetable',     label: 'Timetable',     desc: 'Build the weekly class schedule' },
    { href: '/admin/fees',          label: 'Fee arrears',   desc: 'Import, record payments, view balances' },
    { href: '/admin/attendance',    label: 'Attendance',    desc: 'Export attendance records as CSV' },
    { href: '/admin/announcements', label: 'Announcements', desc: 'Post notices to staff and students' },
    { href: '/teacher/assessments', label: 'Assessments',   desc: 'View all assessments and grades' },
  ];

  return (
    <div className="space-y-10">
      <DeniedBanner reason={searchParams.denied} />
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Admin dashboard</h1>
        <p className="text-base text-slate-600 mt-1">Manage your school setup and users.</p>
      </header>

      {/* The school in figures, a ledger row */}
      <section aria-label="School figures">
        <div className="ledger">
          {statCards.map((card) => (
            <Link key={card.href} href={card.href} className="ledger-cell">
              <span className="block text-sm text-slate-600">{card.label}</span>
              <span className={`block text-2xl font-semibold tabular mt-1 ${card.tone ?? ''}`}>{card.value}</span>
              {card.sub && <span className="block text-xs text-slate-500 mt-0.5">{card.sub}</span>}
            </Link>
          ))}
        </div>
      </section>

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* What's new for you — replaces the old separate announcements +
            platform-messages widgets with one unified feed. */}
        {userRow && (
          <section>
            <h2 className="text-lg font-semibold mb-4">What&apos;s new for you</h2>
            <DashboardFeed userId={userRow.id} role="ADMIN" />
          </section>
        )}

        {/* Setup, as an index */}
        <section aria-labelledby="setup-heading">
          <h2 id="setup-heading" className="text-lg font-semibold mb-2">School setup</h2>
          <nav aria-labelledby="setup-heading">
            {setupLinks.map((link) => (
              <Link key={link.href} href={link.href} className="index-link">
                <span className="font-semibold text-sm">{link.label}</span>
                <span className="text-sm text-slate-600">{link.desc}</span>
              </Link>
            ))}
          </nav>
        </section>
      </div>

      <UpcomingEvents events={(events ?? []) as any[]} />
    </div>
  );
}
