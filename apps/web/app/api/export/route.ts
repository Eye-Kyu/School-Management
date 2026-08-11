import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getPostHogClient } from '@/lib/posthog-server';

export async function GET() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: userRow } = await supabase.from('users').select('id, full_name, email, phone, role, avatar_url, created_at').eq('auth_id', user.id).maybeSingle();
  if (!userRow) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  // Collect all data for this user
  const [
    { data: student },
    { data: notifPrefs },
    { data: notifications },
  ] = await Promise.all([
    supabase.from('students').select('id, admission_no, current_class_id').eq('user_id', userRow.id).maybeSingle(),
    supabase.from('notification_preferences').select('notification_type, email_enabled').eq('user_id', userRow.id),
    supabase.from('notifications').select('type, title, body, is_read, created_at').eq('recipient_id', userRow.id).order('created_at', { ascending: false }).limit(200),
  ]);

  let grades: unknown[] = [], attendance: unknown[] = [], submissions: unknown[] = [];
  if (student) {
    const [g, a, s] = await Promise.all([
      supabase.from('grades').select('score, comment, created_at, assessment:assessments!assessment_id(name, max_marks)').eq('student_id', student.id),
      supabase.from('attendance_records').select('date, status').eq('student_id', student.id).order('date'),
      supabase.from('submissions').select('submitted_at, is_late, grade_score, grade_comment, assignment:assignments!assignment_id(title, due_date)').eq('student_id', student.id),
    ]);
    grades = g.data ?? [];
    attendance = a.data ?? [];
    submissions = s.data ?? [];
  }

  const exportData = {
    exported_at: new Date().toISOString(),
    profile: userRow,
    notification_preferences: notifPrefs ?? [],
    notifications: notifications ?? [],
    academic: student ? { student_record: student, grades, attendance, submissions } : null,
  };

  const posthog = getPostHogClient();
  if (posthog) {
    posthog.capture({ distinctId: user.id, event: 'user_data_exported', properties: { role: userRow.role } });
    await posthog.flush();
  }

  return new NextResponse(JSON.stringify(exportData, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="my-data-${new Date().toISOString().slice(0, 10)}.json"`,
    },
  });
}
