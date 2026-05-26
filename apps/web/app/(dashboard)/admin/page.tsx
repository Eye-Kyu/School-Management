import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import UpcomingEvents from '@/components/UpcomingEvents';

type StatCard = {
  label: string;
  value: string | number;
  sub?: string;
  href: string;
  gradient: string;
};

export default async function AdminHomePage() {
  const supabase = createClient();

  const now = new Date().toISOString();
  const in30Days = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  const [
    { count: classCount },
    { count: teacherCount },
    { count: studentCount },
    { count: parentCount },
    { data: feeData },
    { data: announcements },
    { data: events },
  ] = await Promise.all([
    supabase.from('classes').select('*', { count: 'exact', head: true }).eq('is_active', true),
    supabase.from('teachers').select('*', { count: 'exact', head: true }),
    supabase.from('students').select('*', { count: 'exact', head: true }).eq('is_active', true),
    supabase.from('users').select('*', { count: 'exact', head: true }).eq('role', 'PARENT').eq('is_active', true),
    supabase.from('fee_balances').select('amount_due, amount_paid'),
    supabase
      .from('announcements')
      .select('id, title, published_at, author:users!inner(full_name)')
      .order('published_at', { ascending: false })
      .limit(3),
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
      gradient: 'from-cyan-500 to-blue-600',
    },
    {
      label: 'Teachers',
      value: teacherCount ?? 0,
      href: '/admin/teachers',
      gradient: 'from-teal-500 to-emerald-600',
    },
    {
      label: 'Students',
      value: studentCount ?? 0,
      href: '/admin/students',
      gradient: 'from-violet-500 to-purple-600',
    },
    {
      label: 'Parents',
      value: parentCount ?? 0,
      href: '/admin/parents',
      gradient: 'from-pink-500 to-rose-600',
    },
    {
      label: 'Fee arrears',
      value: `KES ${totalOutstanding.toLocaleString()}`,
      sub: 'outstanding',
      href: '/admin/fees',
      gradient: totalOutstanding > 0 ? 'from-amber-500 to-orange-600' : 'from-emerald-500 to-teal-600',
    },
  ];

  const setupLinks = [
    { href: '/admin/terms',         label: 'Terms',         desc: 'Create the current academic term',        color: 'text-sky-600 bg-sky-50 border-sky-200' },
    { href: '/admin/classes',       label: 'Classes',       desc: 'Add grade levels and streams',            color: 'text-cyan-600 bg-cyan-50 border-cyan-200' },
    { href: '/admin/subjects',      label: 'Subjects',      desc: 'Define subjects and assign teachers',     color: 'text-indigo-600 bg-indigo-50 border-indigo-200' },
    { href: '/admin/teachers',      label: 'Teachers',      desc: 'Create teacher accounts',                 color: 'text-teal-600 bg-teal-50 border-teal-200' },
    { href: '/admin/students',      label: 'Students',      desc: 'Enrol students and link to classes',      color: 'text-violet-600 bg-violet-50 border-violet-200' },
    { href: '/admin/parents',       label: 'Parents',       desc: 'Create parent accounts and link children', color: 'text-pink-600 bg-pink-50 border-pink-200' },
    { href: '/admin/timetable',     label: 'Timetable',     desc: 'Build the weekly class schedule',         color: 'text-blue-600 bg-blue-50 border-blue-200' },
    { href: '/admin/fees',          label: 'Fee arrears',   desc: 'Import, record payments, view balances',  color: 'text-amber-600 bg-amber-50 border-amber-200' },
    { href: '/admin/attendance',    label: 'Attendance',    desc: 'Export attendance records as CSV',         color: 'text-green-600 bg-green-50 border-green-200' },
    { href: '/admin/announcements', label: 'Announcements', desc: 'Post notices to staff and students',      color: 'text-rose-600 bg-rose-50 border-rose-200' },
    { href: '/teacher/assessments', label: 'Assessments',   desc: 'View all assessments and grades',         color: 'text-violet-600 bg-violet-50 border-violet-200' },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Admin dashboard</h1>
        <p className="text-sm text-slate-500 mt-1">Manage your school setup and users.</p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((card) => (
          <Link key={card.href} href={card.href} className="block group">
            <div className="rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition-shadow">
              <div className={`bg-gradient-to-br ${card.gradient} px-5 py-5`}>
                <p className="text-3xl font-bold text-white">{card.value}</p>
                <p className="text-white/80 text-sm mt-1">{card.label}</p>
                {card.sub && <p className="text-white/60 text-xs mt-0.5">{card.sub}</p>}
              </div>
              <div className="bg-white px-5 py-2.5 flex justify-end">
                <span className="text-xs text-slate-400 group-hover:text-slate-700 transition-colors">
                  View details →
                </span>
              </div>
            </div>
          </Link>
        ))}
      </div>

      {/* Latest announcements */}
      {(announcements ?? []).length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-semibold text-slate-700">Recent announcements</h2>
            <Link href="/admin/announcements" className="text-xs text-slate-400 hover:text-slate-700 transition-colors">
              View all →
            </Link>
          </div>
          <div className="space-y-2">
            {(announcements ?? []).map((a: any) => (
              <div key={a.id}
                className="bg-white border border-slate-100 border-l-4 border-l-rose-400
                           rounded-r-xl px-5 py-3 shadow-sm flex items-center justify-between">
                <div>
                  <p className="font-medium text-sm">{a.title}</p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {new Date(a.published_at).toLocaleDateString()} · {a.author?.full_name}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Setup links */}
      <div>
        <h2 className="text-base font-semibold text-slate-700 mb-3">School setup</h2>
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
          {setupLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`rounded-xl border p-4 hover:shadow-md transition-shadow ${link.color}`}
            >
              <p className="font-semibold text-sm">{link.label}</p>
              <p className="text-xs opacity-70 mt-1">{link.desc}</p>
            </Link>
          ))}
        </div>
      </div>

      <UpcomingEvents events={(events ?? []) as any[]} />
    </div>
  );
}
