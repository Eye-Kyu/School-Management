import { Injectable, ForbiddenException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { SupabaseService } from '../supabase/supabase.service';
import type {
  AttendanceQuery,
  AttendanceRosterQuery,
  MarkAttendanceInput,
} from '@school-manager/types';

@Injectable()
export class AttendanceService {
  constructor(private readonly supabase: SupabaseService) {}

  async list(accessToken: string, query: AttendanceQuery) {
    const client = this.supabase.forUser(accessToken);
    let q = client
      .from('attendance_records')
      .select('id, student_id, class_id, date, status, note, marked_by_id, created_at');

    if (query.studentId) q = q.eq('student_id', query.studentId);
    if (query.classId) q = q.eq('class_id', query.classId);
    if (query.startDate) q = q.gte('date', query.startDate);
    if (query.endDate) q = q.lte('date', query.endDate);

    const { data, error } = await q.order('date', { ascending: false }).limit(500);
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async roster(accessToken: string, query: AttendanceRosterQuery) {
    const client = this.supabase.forUser(accessToken);

    const [{ data: students, error: studentsErr }, { data: records }] = await Promise.all([
      client
        .from('students')
        .select('id, admission_no, user:users!inner(full_name)')
        .eq('current_class_id', query.classId)
        .eq('is_active', true)
        .order('admission_no'),
      client
        .from('attendance_records')
        .select('student_id, status, note')
        .eq('class_id', query.classId)
        .eq('date', query.date),
    ]);
    if (studentsErr) throw new Error(studentsErr.message);

    const statusMap = Object.fromEntries(
      (records ?? []).map((r) => [r.student_id, { status: r.status, note: r.note }]),
    );

    return (students ?? []).map((s) => ({
      id: s.id,
      admissionNo: s.admission_no,
      fullName: (s.user as unknown as { full_name: string } | null)?.full_name ?? '',
      attendance: statusMap[s.id] ?? null,
    }));
  }

  async mark(accessToken: string, authUserId: string, input: MarkAttendanceInput) {
    const client = this.supabase.forUser(accessToken);

    // Resolve teachers.id (the FK for marked_by_id) and public.users.id (for audit log).
    const { data: teacherRecord } = await client
      .from('teachers')
      .select('id, user:users!inner(id, auth_id)')
      .eq('users.auth_id', authUserId)
      .maybeSingle();

    if (!teacherRecord) {
      throw new ForbiddenException('Only teachers can mark attendance');
    }
    const markedById = teacherRecord.id;
    const publicUserId = (teacherRecord.user as unknown as { id: string }).id;

    const { data: cls, error: clsErr } = await client
      .from('classes')
      .select('id, school_id')
      .eq('id', input.classId)
      .single();
    if (clsErr || !cls) throw new Error('Class not found or not accessible');

    const now = new Date().toISOString();

    // Fetch existing records for this class on this date so we can
    // update them (keeping the same PK) instead of upsert-changing the PK.
    const { data: existing } = await client
      .from('attendance_records')
      .select('id, student_id')
      .eq('class_id', input.classId)
      .eq('date', input.date);

    const existingMap = Object.fromEntries(
      (existing ?? []).map((r) => [r.student_id, r.id]),
    );

    const toInsert = input.records
      .filter((r) => !existingMap[r.studentId])
      .map((r) => ({
        id: randomUUID(),
        school_id: cls.school_id,
        class_id: input.classId,
        student_id: r.studentId,
        date: input.date,
        status: r.status,
        note: r.note ?? null,
        marked_by_id: markedById,
        updated_at: now,
      }));

    const toUpdate = input.records
      .filter((r) => existingMap[r.studentId])
      .map((r) => ({
        id: existingMap[r.studentId] as string,
        status: r.status,
        note: r.note ?? null,
        marked_by_id: markedById,
        updated_at: now,
      }));

    const inserts = toInsert.length > 0
      ? client.from('attendance_records').insert(toInsert).select()
      : Promise.resolve({ data: [], error: null });

    // Batch updates: update each changed record individually
    const updateResults = await Promise.all(
      toUpdate.map((u) =>
        client
          .from('attendance_records')
          .update({ status: u.status, note: u.note, marked_by_id: u.marked_by_id, updated_at: u.updated_at })
          .eq('id', u.id)
          .select(),
      ),
    );

    const { data: insertedData, error } = await inserts;
    if (error) throw new Error(error.message);
    const updateError = updateResults.find((r) => r.error)?.error;
    if (updateError) throw new Error(updateError.message);

    const totalUpserted = (insertedData?.length ?? 0) + toUpdate.length;

    await client.from('audit_logs').insert({
      id: randomUUID(),
      school_id: cls.school_id,
      user_id: publicUserId,
      action: 'attendance.mark',
      entity_type: 'attendance_record',
      entity_id: input.classId,
      metadata: { classId: input.classId, date: input.date, count: input.records.length },
    });

    return { upserted: totalUpserted };
  }
}
