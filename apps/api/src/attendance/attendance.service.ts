import { Injectable, ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { SupabaseService } from '../supabase/supabase.service';
import { NotificationsService } from '../notifications/notifications.service';
import type {
  AttendanceQuery,
  AttendanceRosterQuery,
  ApprovedAbsencesQuery,
  MarkAttendanceInput,
  RequestRemarkInput,
  ReviewRemarkRequestInput,
} from '@school-manager/types';

// Inclusive list of ISO YYYY-MM-DD dates from start to end. Used to expand
// an absence_requests date range into the per-day shape
// getApprovedAbsencesForStudent()'s callers (and calculateAttendanceRate)
// expect.
function datesBetween(start: string, end: string): string[] {
  const dates: string[] = [];
  let cursor = new Date(`${start}T00:00:00Z`);
  const endDate = new Date(`${end}T00:00:00Z`);
  while (cursor <= endDate) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor = new Date(cursor.getTime() + 86_400_000);
  }
  return dates;
}

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

    const studentIds = (students ?? []).map((s) => s.id);
    const excusedIds = studentIds.length > 0
      ? await this._approvedAbsenceStudentIds(studentIds, query.date)
      : new Set<string>();

    return (students ?? []).map((s) => ({
      id: s.id,
      admissionNo: s.admission_no,
      fullName: (s.user as unknown as { full_name: string } | null)?.full_name ?? '',
      attendance: statusMap[s.id] ?? (excusedIds.has(s.id) ? { status: 'EXCUSED', note: 'Approved absence' } : null),
      excusedByAbsenceRequest: excusedIds.has(s.id),
    }));
  }

  // Students in `studentIds` who have an APPROVED absence_requests row
  // covering `date`. No attendance_records rows are ever written for these
  // dates — the EXCUSED status is computed here, at read time, only.
  //
  // Uses the admin client deliberately: this is an internal enforcement/
  // overlay check, not a direct read of absence_requests handed back to the
  // caller — absence_requests' own RLS only grants SELECT to the student's
  // Class Teacher (not every subject teacher who can mark attendance for
  // that class), so a subject teacher's forUser client would silently see
  // no rows here and the override gate in mark() would never trigger.
  private async _approvedAbsenceStudentIds(
    studentIds: string[],
    date: string,
  ): Promise<Set<string>> {
    const { data } = await this.supabase.admin
      .from('absence_requests')
      .select('student_id')
      .in('student_id', studentIds)
      .eq('status', 'APPROVED')
      .lte('start_date', date)
      .gte('end_date', date);
    return new Set((data ?? []).map((r) => r.student_id));
  }

  // Self-service approved-absence view (Foundation PR, shared-helpers) — a
  // separate, narrower access surface from roster()/mark()'s own internal
  // overlay check above. Exists because absence_requests_select RLS grants
  // ADMIN, the requesting parent, and the student's Class Teacher (plus a
  // subject teacher of the class) — but no branch at all for the student
  // themselves or for a non-submitting guardian, so those two roles have had
  // no working path to see approved absences until now.
  async getApprovedAbsencesForStudent(accessToken: string, studentId: string, query: ApprovedAbsencesQuery) {
    const userRow = (await this.supabase.currentUserRow(accessToken, 'id, role, school_id')) as
      { id: string; role: string; school_id: string } | null;
    if (!userRow) throw new ForbiddenException('User not found');

    const { data: student } = await this.supabase.admin
      .from('students')
      .select('id, school_id, current_class_id, user_id')
      .eq('id', studentId)
      .maybeSingle();
    // Hide existence from a cross-tenant caller (404, not 403) — same
    // convention as MessagingService.markRead().
    if (!student || student.school_id !== userRow.school_id) {
      throw new NotFoundException('Student not found');
    }

    let reasonVisibility: 'ALL' | 'OWN_ONLY' | 'NONE';
    if (userRow.role === 'ADMIN') {
      reasonVisibility = 'ALL';
    } else if (userRow.role === 'TEACHER') {
      const { data: teacherRow } = await this.supabase.admin
        .from('teachers').select('is_class_teacher_of').eq('user_id', userRow.id).maybeSingle();
      if (teacherRow?.is_class_teacher_of !== student.current_class_id) {
        throw new ForbiddenException('You are not the class teacher of this student');
      }
      reasonVisibility = 'ALL';
    } else if (userRow.role === 'STUDENT') {
      if (student.user_id !== userRow.id) {
        throw new ForbiddenException('You may only view your own attendance');
      }
      reasonVisibility = 'NONE';
    } else if (userRow.role === 'PARENT') {
      const { data: guardianRow } = await this.supabase.admin
        .from('guardians').select('id').eq('user_id', userRow.id).eq('student_id', studentId).maybeSingle();
      if (!guardianRow) throw new ForbiddenException('You are not a guardian of this student');
      reasonVisibility = 'OWN_ONLY';
    } else {
      throw new ForbiddenException("Not authorized to view this student's attendance");
    }

    const { data: requests } = await this.supabase.admin
      .from('absence_requests')
      .select('id, start_date, end_date, reason, requested_by_user_id, reviewed_by_user_id, reviewed_at')
      .eq('student_id', studentId)
      .eq('status', 'APPROVED')
      .lte('start_date', query.endDate)
      .gte('end_date', query.startDate);

    const reviewerIds = [
      ...new Set((requests ?? []).map((r) => r.reviewed_by_user_id).filter((id): id is string => !!id)),
    ];
    const { data: reviewers } = reviewerIds.length > 0
      ? await this.supabase.admin.from('users').select('id, role').in('id', reviewerIds)
      : { data: [] as Array<{ id: string; role: string }> };
    const reviewerRoleById = new Map((reviewers ?? []).map((r) => [r.id, r.role]));

    const approved_absences: Array<{
      id: string;
      absence_date: string;
      approved_at: string | null;
      approved_by_role: 'ADMIN' | 'TEACHER' | null;
      submitted_by_current_user: boolean;
      reason?: string;
    }> = [];

    for (const req of requests ?? []) {
      const submittedByCurrentUser = req.requested_by_user_id === userRow.id;
      const showReason = reasonVisibility === 'ALL' || (reasonVisibility === 'OWN_ONLY' && submittedByCurrentUser);
      const reviewerRole = req.reviewed_by_user_id ? reviewerRoleById.get(req.reviewed_by_user_id) : undefined;
      const approvedByRole: 'ADMIN' | 'TEACHER' | null =
        reviewerRole === 'ADMIN' || reviewerRole === 'TEACHER' ? reviewerRole : null;

      // absence_requests stores a date range; the response is per-day, and
      // must only cover the overlap with the caller's requested window.
      const rangeStart = req.start_date > query.startDate ? req.start_date : query.startDate;
      const rangeEnd = req.end_date < query.endDate ? req.end_date : query.endDate;
      for (const date of datesBetween(rangeStart, rangeEnd)) {
        approved_absences.push({
          id: req.id,
          absence_date: date,
          approved_at: req.reviewed_at,
          approved_by_role: approvedByRole,
          submitted_by_current_user: submittedByCurrentUser,
          ...(showReason ? { reason: req.reason } : {}),
        });
      }
    }

    await this.supabase.admin.from('audit_logs').insert({
      id: randomUUID(),
      school_id: userRow.school_id,
      user_id: userRow.id,
      action: 'absence_requests.list',
      entity_type: 'student',
      entity_id: studentId,
      metadata: { target_student_id: studentId, requester_role: userRow.role },
    });

    return { approved_absences };
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

    // Days covered by an approved absence request are non-editable here —
    // the only way to change them is Task 3's re-marking approval flow.
    // Silently drop those students from this write and audit the attempt,
    // rather than rejecting the whole batch (the rest of the class may still
    // need marking).
    const requestedStudentIds = input.records.map((r) => r.studentId);
    const excusedIds = await this._approvedAbsenceStudentIds(requestedStudentIds, input.date);
    const blockedRecords = input.records.filter((r) => excusedIds.has(r.studentId));
    const records = input.records.filter((r) => !excusedIds.has(r.studentId));

    if (blockedRecords.length > 0) {
      await client.from('audit_logs').insert(blockedRecords.map((r) => ({
        id: randomUUID(), school_id: cls.school_id, user_id: publicUserId,
        action: 'absence.override_attempt', entity_type: 'attendance_record', entity_id: input.classId,
        metadata: { classId: input.classId, date: input.date, studentId: r.studentId, attemptedStatus: r.status },
      })));
    }

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

    const toInsert = records
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

    const toUpdate = records
      .filter((r) => existingMap[r.studentId])
      .map((r) => ({
        id: existingMap[r.studentId] as string,
        studentId: r.studentId,
        status: r.status,
        note: r.note ?? null,
        marked_by_id: markedById,
        updated_at: now,
      }));

    // Re-marking gate: any student whose record already exists requires a
    // matching APPROVED, not-yet-applied remark request from this same
    // teacher for this exact (class, date). First-time submissions
    // (toInsert) are never gated — only changes to an existing record are.
    let consumedRequestId: string | null = null;
    if (toUpdate.length > 0) {
      consumedRequestId = await this._authorizeRemark(client, publicUserId, input.classId, input.date, toUpdate);
    }

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

    if (records.length > 0) {
      await client.from('audit_logs').insert({
        id: randomUUID(),
        school_id: cls.school_id,
        user_id: publicUserId,
        action: 'attendance.mark',
        entity_type: 'attendance_record',
        entity_id: input.classId,
        metadata: { classId: input.classId, date: input.date, count: records.length },
      });
    }

    if (consumedRequestId) {
      // Single-use: applying the approval consumes it — a second mark() call
      // referencing the same request id will find applied_at already set and
      // be rejected by _authorizeRemark below.
      await client.from('attendance_remark_requests').update({ applied_at: now, updated_at: now }).eq('id', consumedRequestId);
      await client.from('audit_logs').insert({
        id: randomUUID(), school_id: cls.school_id, user_id: publicUserId,
        action: 'attendance.remark_apply', entity_type: 'attendance_remark_request', entity_id: consumedRequestId,
        metadata: { classId: input.classId, date: input.date },
      });
    }

    // Queue absence notifications for guardians of absent students
    const absentIds = records.filter((r) => r.status === 'ABSENT').map((r) => r.studentId);
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

  // Approval is single-use and authorizes exactly the pending edits it
  // describes — not "the day is unlocked." Every student+proposed-status in
  // `changes` must appear, one-for-one, in the approved request's items; any
  // mismatch (extra student, different proposed status, subset) is rejected.
  private async _authorizeRemark(
    client: ReturnType<SupabaseService['forUser']>,
    requestedByUserId: string,
    classId: string,
    date: string,
    changes: Array<{ studentId: string; status: string }>,
  ): Promise<string> {
    const { data: candidates } = await client
      .from('attendance_remark_requests')
      .select('id, status, applied_at, expires_at')
      .eq('class_id', classId).eq('date', date).eq('requested_by_user_id', requestedByUserId)
      .eq('status', 'APPROVED').is('applied_at', null)
      .order('reviewed_at', { ascending: false });

    const now = Date.now();
    for (const candidate of candidates ?? []) {
      if (new Date(candidate.expires_at).getTime() < now) continue; // expired — try an older/other one, then fall through to the clear error below

      const { data: items } = await client
        .from('attendance_remark_request_items')
        .select('student_id, proposed_status')
        .eq('request_id', candidate.id);

      const proposed = new Map((items ?? []).map((i) => [i.student_id, i.proposed_status]));
      const matchesExactly =
        proposed.size === changes.length &&
        changes.every((c) => proposed.get(c.studentId) === c.status);

      if (matchesExactly) return candidate.id;
    }

    // Distinguish "no approval exists" from "one existed but expired" for a
    // clearer error message, per the spec's explicit requirement.
    const hadOnlyExpired = (candidates ?? []).some((c) => new Date(c.expires_at).getTime() < now);
    if (hadOnlyExpired) {
      throw new ForbiddenException('Your approved re-marking request has expired (72-hour window) — submit a new request');
    }
    throw new ForbiddenException(
      'Attendance for this class and date has already been submitted. Submit a re-marking request and wait for Department Head approval before changing it.',
    );
  }

  async requestRemark(accessToken: string, _authUserId: string, input: RequestRemarkInput) {
    const client = this.supabase.forUser(accessToken);
    const me = await this.supabase.currentUserRow(accessToken, 'id') as { id: string } | null;
    if (!me) throw new ForbiddenException('User not found');

    const { data: teacherRecord } = await client
      .from('teachers').select('id, user_id, department_id, school_id').eq('user_id', me.id).maybeSingle();
    if (!teacherRecord) throw new ForbiddenException('Only teachers can request a re-marking');

    const { data: existingRecords } = await client
      .from('attendance_records').select('student_id, status')
      .eq('class_id', input.classId).eq('date', input.date).in('student_id', input.items.map((i) => i.studentId));
    const currentByStudent = new Map((existingRecords ?? []).map((r) => [r.student_id, r.status]));

    const requestId = randomUUID();
    const { error: reqError } = await client.from('attendance_remark_requests').insert({
      id: requestId, school_id: teacherRecord.school_id, class_id: input.classId, date: input.date,
      requested_by_user_id: teacherRecord.user_id, reason: input.reason,
    });
    if (reqError) throw new Error(reqError.message);

    const { error: itemsError } = await client.from('attendance_remark_request_items').insert(
      input.items.map((i) => ({
        id: randomUUID(), request_id: requestId, student_id: i.studentId,
        current_status: currentByStudent.get(i.studentId) ?? 'PRESENT',
        proposed_status: i.proposedStatus, proposed_note: i.proposedNote ?? null,
      })),
    );
    if (itemsError) throw new Error(itemsError.message);

    await client.from('audit_logs').insert({
      id: randomUUID(), school_id: teacherRecord.school_id, user_id: teacherRecord.user_id,
      action: 'attendance.remark_request', entity_type: 'attendance_remark_request', entity_id: requestId,
      metadata: { classId: input.classId, date: input.date, itemCount: input.items.length },
    });

    // Route to the requester's own Department Head; fall back to Admin if
    // unset. This applies identically whether the requester is a subject
    // teacher or the Class Teacher of the class they're re-marking — Class
    // Teachers still belong to a department, per the spec.
    let recipientId: string | null = null;
    if (teacherRecord.department_id) {
      const { data: dept } = await this.supabase.admin
        .from('departments').select('department_head_user_id').eq('id', teacherRecord.department_id).maybeSingle();
      recipientId = dept?.department_head_user_id ?? null;
    }
    if (!recipientId) {
      const { data: admins } = await this.supabase.admin
        .from('users').select('id').eq('school_id', teacherRecord.school_id).eq('role', 'ADMIN').eq('is_active', true).is('deleted_at', null);
      await this.notifications.queue((admins ?? []).map((a) => ({
        schoolId: teacherRecord.school_id, recipientId: a.id, type: 'ATTENDANCE_REMARK_REQUESTED' as const,
        title: 'Attendance re-marking request', body: `A teacher requested to change attendance for a class on ${input.date}.`,
        metadata: { requestId, classId: input.classId, date: input.date },
      })));
    } else {
      await this.notifications.queue([{
        schoolId: teacherRecord.school_id, recipientId, type: 'ATTENDANCE_REMARK_REQUESTED',
        title: 'Attendance re-marking request', body: `A teacher in your department requested to change attendance for a class on ${input.date}.`,
        metadata: { requestId, classId: input.classId, date: input.date },
      }]);
    }

    return { id: requestId };
  }

  async listRemarkRequests(accessToken: string) {
    const { data, error } = await this.supabase.forUser(accessToken)
      .from('attendance_remark_requests')
      .select(`
        id, class_id, date, reason, status, reviewed_at, denial_reason, applied_at, expires_at, created_at,
        requested_by_user_id, requested_by:users!requested_by_user_id(full_name),
        class:classes(name),
        items:attendance_remark_request_items(student_id, current_status, proposed_status, proposed_note, student:students!inner(admission_no, user:users!inner(full_name)))
      `)
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async reviewRemarkRequest(accessToken: string, requestId: string, input: ReviewRemarkRequestInput) {
    const client = this.supabase.forUser(accessToken);
    const me = await this.supabase.currentUserRow(accessToken, 'id') as { id: string } | null;
    if (!me) throw new ForbiddenException('User not found');

    const { data: reqRow } = await client.from('attendance_remark_requests').select('id, school_id, requested_by_user_id, status').eq('id', requestId).maybeSingle();
    if (!reqRow) throw new NotFoundException('Request not found');
    if (reqRow.status !== 'PENDING') throw new BadRequestException('This request has already been decided');
    if (reqRow.requested_by_user_id === me.id) throw new ForbiddenException('You cannot approve your own re-marking request');

    if (input.action === 'DENY' && !input.denialReason) {
      throw new BadRequestException('A reason is required to deny a re-marking request');
    }

    const { error } = await client.from('attendance_remark_requests').update({
      status: input.action === 'APPROVE' ? 'APPROVED' : 'DENIED',
      reviewed_by_user_id: me.id, reviewed_at: new Date().toISOString(),
      denial_reason: input.action === 'DENY' ? input.denialReason : null,
      updated_at: new Date().toISOString(),
    }).eq('id', requestId);
    if (error) throw new Error(error.message);

    await client.from('audit_logs').insert({
      id: randomUUID(), school_id: reqRow.school_id, user_id: me.id,
      action: input.action === 'APPROVE' ? 'attendance.remark_approve' : 'attendance.remark_deny',
      entity_type: 'attendance_remark_request', entity_id: requestId,
      metadata: input.action === 'DENY' ? { denialReason: input.denialReason } : {},
    });

    await this.notifications.queue([{
      schoolId: reqRow.school_id, recipientId: reqRow.requested_by_user_id, type: 'ATTENDANCE_REMARK_DECIDED',
      title: input.action === 'APPROVE' ? 'Re-marking request approved' : 'Re-marking request denied',
      body: input.action === 'APPROVE' ? 'You can now apply your requested attendance changes.' : (input.denialReason ?? 'Your re-marking request was denied.'),
      metadata: { requestId },
    }]);

    return { updated: true };
  }
}

function csvCell(v: string): string {
  return v.includes(',') || v.includes('"') || v.includes('\n')
    ? `"${v.replace(/"/g, '""')}"` : v;
}
