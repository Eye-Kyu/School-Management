import { createClient } from '@/lib/supabase/server';
import BackButton from '@/components/BackButton';
import Link from 'next/link';

type CheckItem = {
  label: string;
  description: string;
  done: boolean;
  href: string;
  action: string;
};

function Check({ done }: { done: boolean }) {
  return done
    ? <span className="w-6 h-6 rounded-full bg-emerald-500 text-white flex items-center justify-center text-sm shrink-0">✓</span>
    : <span className="w-6 h-6 rounded-full border-2 border-slate-300 flex items-center justify-center shrink-0" />;
}

export default async function SetupChecklistPage() {
  const supabase = createClient();

  const [
    { count: termCount },
    { count: classCount },
    { count: subjectCount },
    { count: teacherCount },
    { count: studentCount },
    { count: timetableCount },
    { count: announcementCount },
    { count: parentCount },
  ] = await Promise.all([
    supabase.from('terms').select('*', { count: 'exact', head: true }),
    supabase.from('classes').select('*', { count: 'exact', head: true }).eq('is_active', true),
    supabase.from('subjects').select('*', { count: 'exact', head: true }),
    supabase.from('teachers').select('*', { count: 'exact', head: true }),
    supabase.from('students').select('*', { count: 'exact', head: true }).eq('is_active', true),
    supabase.from('timetable_slots').select('*', { count: 'exact', head: true }),
    supabase.from('announcements').select('*', { count: 'exact', head: true }),
    supabase.from('users').select('*', { count: 'exact', head: true }).eq('role', 'PARENT').eq('is_active', true),
  ]);

  const steps: CheckItem[] = [
    {
      label: 'Create a term',
      description: 'Set up the current academic term with start and end dates.',
      done: (termCount ?? 0) > 0,
      href: '/admin/terms',
      action: 'Add term',
    },
    {
      label: 'Create classes',
      description: 'Add the grade levels and streams (e.g. Grade 5 Blue, Form 2 North).',
      done: (classCount ?? 0) > 0,
      href: '/admin/classes',
      action: 'Add classes',
    },
    {
      label: 'Add subjects',
      description: 'Create subjects that will be taught across classes.',
      done: (subjectCount ?? 0) > 0,
      href: '/admin/subjects',
      action: 'Add subjects',
    },
    {
      label: 'Enrol teachers',
      description: 'Add teacher accounts and assign them to classes and subjects.',
      done: (teacherCount ?? 0) > 0,
      href: '/admin/teachers',
      action: 'Add teachers',
    },
    {
      label: 'Enrol students',
      description: 'Register students and assign them to their classes.',
      done: (studentCount ?? 0) > 0,
      href: '/admin/students',
      action: 'Add students',
    },
    {
      label: 'Link parents',
      description: 'Create parent accounts and link them to their children.',
      done: (parentCount ?? 0) > 0,
      href: '/admin/parents',
      action: 'Add parents',
    },
    {
      label: 'Set up timetable',
      description: 'Enter the weekly schedule — class × subject × teacher × time.',
      done: (timetableCount ?? 0) > 0,
      href: '/admin/timetable',
      action: 'Build timetable',
    },
    {
      label: 'Post first announcement',
      description: 'Send a welcome message to teachers and parents.',
      done: (announcementCount ?? 0) > 0,
      href: '/admin/announcements',
      action: 'Post announcement',
    },
  ];

  const completed = steps.filter((s) => s.done).length;
  const pct = Math.round((completed / steps.length) * 100);

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-4">
        <BackButton href="/admin" />
        <div>
          <h1 className="text-2xl font-semibold">School setup</h1>
          <p className="text-sm text-slate-500 mt-0.5">Complete these steps to get your school running.</p>
        </div>
      </div>

      {/* Progress */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-slate-700">{completed} of {steps.length} steps complete</p>
          <span className={`text-sm font-bold ${pct === 100 ? 'text-emerald-600' : 'text-slate-600'}`}>{pct}%</span>
        </div>
        <div className="h-3 bg-slate-100 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${pct === 100 ? 'bg-emerald-500' : 'bg-slate-800'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        {pct === 100 && (
          <p className="text-sm text-emerald-600 font-medium">🎉 Setup complete! Your school is ready to use.</p>
        )}
      </div>

      {/* Steps */}
      <div className="space-y-2">
        {steps.map((step, i) => (
          <div
            key={i}
            className={`bg-white border rounded-xl px-5 py-4 flex items-center gap-4 ${
              step.done ? 'border-emerald-100' : 'border-slate-200'
            }`}
          >
            <Check done={step.done} />
            <div className="flex-1 min-w-0">
              <p className={`font-medium ${step.done ? 'text-slate-400 line-through' : 'text-slate-800'}`}>
                {step.label}
              </p>
              <p className="text-xs text-slate-400 mt-0.5">{step.description}</p>
            </div>
            {!step.done && (
              <Link
                href={step.href}
                className="shrink-0 text-xs bg-slate-900 text-white px-3 py-1.5 rounded-lg hover:bg-slate-700 font-medium"
              >
                {step.action}
              </Link>
            )}
          </div>
        ))}
      </div>

      {/* Next steps after full setup */}
      {pct === 100 && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 space-y-2">
          <h2 className="font-semibold text-slate-800">What to do next</h2>
          <ul className="text-sm text-slate-600 space-y-1 list-disc list-inside">
            <li>Ask teachers to start marking daily attendance</li>
            <li>Share the parent login URL so parents can track their children</li>
            <li>Create the term's assessment schedule in the gradebook</li>
            <li>Set up fee balances via CSV import</li>
          </ul>
        </div>
      )}
    </div>
  );
}
