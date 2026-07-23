import { Injectable, ForbiddenException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { SupabaseService } from '../supabase/supabase.service';
import { NotificationsService } from '../notifications/notifications.service';
import type {
  AttendanceQuery,
  AttendanceRosterQuery,
  MarkAttendanceInput,
} from '@school-manager/types';

@Injectable()
export class AttendanceService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly notifications: NotificationsService,
  ) {}

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

  async exportCsv(accessToken: string, query: { classId?: string; dateFrom?: string; dateTo?: string }) {
    const client = this.supabase.forUser(accessToken);

    // A TEACHER may only export a specific class if they're its class
    // teacher (admin is unrestricted; a teacher exporting with no classId
    // filter is unchanged/pre-existing behavior, not newly gated here).
    if (query.classId) {
      const userRow = await this.supabase.currentUserRow(accessToken, 'id, role') as
        { id: string; role: string } | null;
      if (userRow?.role === 'TEACHER') {
        const { data: teacherRow } = await client
          .from('teachers').select('is_class_teacher_of').eq('user_id', userRow.id).maybeSingle();
        if (teacherRow?.is_class_teacher_of !== query.classId) {
          throw new ForbiddenException('You are not the class teacher of this class');
        }
      }
    }

    let q = client
      .from('attendance_records')
      .select('date, status, note, student:students!inner(admission_no, user:users!inner(full_name)), class:classes!inner(name)')
      .order('date', { ascending: false })
      .order('student_id', { ascending: true });

    if (query.classId) q = q.eq('class_id', query.classId);
    if (query.dateFrom) q = q.gte('date', query.dateFrom);
    if (query.dateTo) q = q.lte('date', query.dateTo);

    const { data, error } = await q;
    if (error) throw new Error(error.message);

    const rows = (data ?? []) as unknown as Array<{
      date: string; status: string; note: string | null;
      student: { admission_no: string; user: { full_name: string } };
      class: { name: string };
    }>;

    const today = new Date().toISOString().slice(0, 10);
    const meta: string[] = [];

    if (query.classId) {
      // Look up class name and class teacher for the header section
      const [{ data: classRow }, { data: teacherRow }] = await Promise.all([
        client.from('classes').select('name').eq('id', query.classId).maybeSingle(),
        client
          .from('teachers')
          .select('user:users!inner(full_name)')
          .eq('is_class_teacher_of', query.classId)
          .maybeSingle(),
      ]);

      const className = classRow?.name ?? 'Unknown class';
      const teacherName = (teacherRow?.user as unknown as { full_name: string } | null)?.full_name ?? 'Not assigned';
      const dateRange = [query.dateFrom, query.dateTo].filter(Boolean).join(' to ') || 'All dates';

      meta.push(
        `# Class: ${className}`,
        `# Class Teacher: ${teacherName}`,
        `# Date Range: ${dateRange}`,
        `# Exported: ${today}`,
        '',
      );
    }

    const header = 'AdmissionNo,Student,Date,Class,Status,Note';
    const lines = rows.map((r) =>
      [r.student.admission_no, csvCell(r.student.user.full_name), r.date, csvCell(r.class.name), r.status, csvCell(r.note ?? '')].join(','),
    );

    const suffix = query.classId ? `_${rows[0]?.class?.name?.replace(/\s+/g, '_') ?? query.classId.slice(0, 8)}` : '';
    return {
      csv: [...meta, header, ...lines].join('\n'),
      filename: `attendance${suffix}_${today}.csv`,
    };
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

    // Queue absence notifications for guardians of absent students
    const absentIds = input.records.filter((r) => r.status === 'ABSENT').map((r) => r.studentId);
    if (absentIds.length > 0) {
      await this.queueAbsenceNotifications(cls.school_id, input.classId, input.date, absentIds);
    }

    return { upserted: totalUpserted };
  }

  private async queueAbsenceNotifications(
    schoolId: string,
    classId: string,
    date: string,
    absentStudentIds: string[],
  ) {
    try {
      // Look up each absent student's name and their guardians
      // Use flat queries to avoid PostgREST join type issues
      const { data: guardianRows } = await this.supabase.admin
        .from('guardians')
        .select('user_id, student_id')
        .in('student_id', absentStudentIds);

      if (!guardianRows?.length) return;

      // Throttle: skip if already notified for this student today
      const todayStart = `${date}T00:00:00.000Z`;
      const todayEnd   = `${date}T23:59:59.999Z`;
      const { data: sentToday } = await this.supabase.admin
        .from('notifications')
        .select('recipient_id, metadata')
        .eq('type', 'ABSENT_STUDENT')
        .gte('created_at', todayStart)
        .lte('created_at', todayEnd);

      const alreadySent = new Set(
        (sentToday ?? []).map((n) => {
          const meta = n.metadata as Record<string, string> | null;
          return `${n.recipient_id}:${meta?.studentId ?? ''}`;
        }),
      );

      // Look up guardian user rows for school_id scoping
      const guardianUserIds = guardianRows.map((g) => g.user_id as string).filter(Boolean);
      const { data: guardianUsers } = await this.supabase.admin
        .from('users').select('id, school_id').in('id', guardianUserIds).eq('school_id', schoolId);

      const guardianSchoolIds = new Set((guardianUsers ?? []).map((u) => u.id));

      // Fetch student names separately
      const { data: studentUsers } = await this.supabase.admin
        .from('students').select('id, user:users!user_id(full_name)').in('id', absentStudentIds);
      const studentNameMap: Record<string, string> = {};
      for (const s of studentUsers ?? []) {
        const fullName = ((s.user as unknown as { full_name: string }[])?.[0]?.full_name) ?? 'Your child';
        studentNameMap[s.id] = fullName;
      }

      const payloads = guardianRows
        .filter((g) => {
          const uid = g.user_id as string;
          const sid = g.student_id as string;
          if (!guardianSchoolIds.has(uid)) return false;
          return !alreadySent.has(`${uid}:${sid}`);
        })
        .map((g) => {
          const uid = g.user_id as string;
          const sid = g.student_id as string;
          const studentName = studentNameMap[sid] ?? 'Your child';
          return {
            schoolId,
            recipientId: uid,
            type: 'ABSENT_STUDENT' as const,
            title: `Absence alert — ${studentName}`,
            body: `${studentName} was marked absent on ${date}. Please contact the school if this is incorrect.`,
            metadata: { date, classId, studentId: sid },
          };
        });

      await this.notifications.queue(payloads);
    } catch (err) {
      console.error('[AttendanceService] absence notification error:', err);
    }
  }
}

function csvCell(v: string): string {
  return v.includes(',') || v.includes('"') || v.includes('\n')
    ? `"${v.replace(/"/g, '""')}"` : v;
}
