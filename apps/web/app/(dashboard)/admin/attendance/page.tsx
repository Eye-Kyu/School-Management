import BackButton from '@/components/BackButton';
import { createClient } from '@/lib/supabase/server';
import AttendanceExportClient from './AttendanceExportClient';

export default async function AdminAttendancePage() {
  const supabase = createClient();
  const { data: classes } = await supabase
    .from('classes')
    .select('id, name, grade_level')
    .eq('is_active', true)
    .order('grade_level')
    .order('name');

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <BackButton href="/admin" />
        <div>
          <h1 className="text-2xl font-semibold">Attendance Export</h1>
          <p className="text-sm text-slate-500 mt-0.5">Download attendance records as CSV</p>
        </div>
      </div>
      <AttendanceExportClient classes={classes ?? []} />
    </div>
  );
}
