import { Injectable, ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { SupabaseService } from '../supabase/supabase.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { SubmitAbsenceRequestInput, ReviewAbsenceRequestInput } from '@school-manager/types';

type Me = { id: string; role: string; full_name: string; school_id: string };

@Injectable()
export class AbsenceRequestsService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly notifications: NotificationsService,
  ) {}

  async submit(accessToken: string, input: SubmitAbsenceRequestInput) {
    const client = this.supabase.forUser(accessToken);
    const me = await this.requireSelf(accessToken);
    if (me.role !== 'PARENT') throw new ForbiddenException('Only a parent/guardian can submit an absence request');

    const { data, error } = await client
      .from('absence_requests')
      .insert({
        id: randomUUID(), school_id: me.school_id, student_id: input.studentId,
        requested_by_user_id: me.id, start_date: input.startDate, end_date: input.endDate, reason: input.reason,
      })
      .select().single();
    // RLS enforces "this is one of my own linked children" at the DB level —
    // a denial surfaces as a Postgres permission error, not a clean 403.
    if (error) throw new ForbiddenException("You don't have permission to request an absence for this student");

    await this.audit(client, accessToken, me.school_id, 'absence.request', 'absence_request', data.id, {
      student_id: input.studentId, start_date: input.startDate, end_date: input.endDate,
    });

    await this.notifyEligibleApprovers(me.school_id, input.studentId, {
      type: 'ABSENCE_REQUEST_SUBMITTED',
      title: 'New absence request',
      body: `A parent requested an excused absence from ${input.startDate} to ${input.endDate}.`,
      metadata: { requestId: data.id, studentId: input.studentId },
    });

    return data;
  }

  async list(accessToken: string) {
    const { data, error } = await this.supabase.forUser(accessToken)
      .from('absence_requests')
      .select(`
        id, student_id, requested_by_user_id, start_date, end_date, reason, status,
        reviewed_by_user_id, reviewed_at, denial_reason, created_at,
        student:students!inner(admission_no, current_class_id, user:users!inner(full_name)),
        requested_by:users!requested_by_user_id(full_name)
      `)
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async review(accessToken: string, requestId: string, input: ReviewAbsenceRequestInput) {
    const client = this.supabase.forUser(accessToken);
    const me = await this.requireSelf(accessToken);
    if (me.role !== 'ADMIN' && me.role !== 'TEACHER') {
      throw new ForbiddenException('Only School Admin or the Class Teacher can review an absence request');
    }

    const { data: reqRow } = await client
      .from('absence_requests')
      .select('id, school_id, student_id, requested_by_user_id, start_date, end_date, status')
      .eq('id', requestId).maybeSingle();
    if (!reqRow) throw new NotFoundException('Request not found');
    if (reqRow.status !== 'PENDING') throw new BadRequestException('This request has already been decided');

    if (input.action === 'DENY' && !input.denialReason) {
      throw new BadRequestException('A reason is required to deny an absence request');
    }

    const { error } = await client.from('absence_requests').update({
      status: input.action === 'APPROVE' ? 'APPROVED' : 'DENIED',
      reviewed_by_user_id: me.id, reviewed_at: new Date().toISOString(),
      denial_reason: input.action === 'DENY' ? input.denialReason : null,
      updated_at: new Date().toISOString(),
    }).eq('id', requestId);
    // RLS restricts UPDATE to Admin or the student's Class Teacher — a
    // Subject Teacher with no relation to this student's class is rejected
    // by Postgres, surfaced here as a clean error.
    if (error) throw new ForbiddenException("You don't have permission to review this request");

    await this.audit(client, accessToken, reqRow.school_id, input.action === 'APPROVE' ? 'absence.approve' : 'absence.deny', 'absence_request', requestId, {
      denial_reason: input.action === 'DENY' ? input.denialReason : undefined,
    });

    await this.notifications.queue([{
      schoolId: reqRow.school_id, recipientId: reqRow.requested_by_user_id, type: 'ABSENCE_REQUEST_DECIDED',
      title: input.action === 'APPROVE' ? 'Absence request approved' : 'Absence request denied',
      body: input.action === 'APPROVE'
        ? `Your absence request from ${reqRow.start_date} to ${reqRow.end_date} was approved.`
        : (input.denialReason ?? 'Your absence request was denied.'),
      metadata: { requestId },
    }]);

    // FYI to the other eligible approver, excluding the one who just acted.
    if (input.action === 'APPROVE') {
      await this.notifyEligibleApprovers(reqRow.school_id, reqRow.student_id, {
        type: 'ABSENCE_REQUEST_DECIDED',
        title: 'Absence request approved',
        body: `An absence request for a student in your scope was approved for ${reqRow.start_date} to ${reqRow.end_date}.`,
        metadata: { requestId, studentId: reqRow.student_id },
      }, me.id);
    }

    return { updated: true };
  }

  // Notifies School Admins + the student's Class Teacher (the two eligible
  // approvers) — used both for "new request" and the post-approval FYI.
  // `excludeUserId` drops the actor themself from the FYI recipient set.
  private async notifyEligibleApprovers(
    schoolId: string,
    studentId: string,
    payload: { type: 'ABSENCE_REQUEST_SUBMITTED' | 'ABSENCE_REQUEST_DECIDED'; title: string; body: string; metadata: Record<string, unknown> },
    excludeUserId?: string,
  ) {
    const { data: student } = await this.supabase.admin
      .from('students').select('current_class_id').eq('id', studentId).maybeSingle();

    const recipientIds = new Set<string>();

    if (student?.current_class_id) {
      const { data: classTeacher } = await this.supabase.admin
        .from('teachers').select('user_id').eq('is_class_teacher_of', student.current_class_id).maybeSingle();
      if (classTeacher?.user_id) recipientIds.add(classTeacher.user_id);
    }

    const { data: admins } = await this.supabase.admin
      .from('users').select('id').eq('school_id', schoolId).eq('role', 'ADMIN').eq('is_active', true).is('deleted_at', null);
    for (const a of admins ?? []) recipientIds.add(a.id);

    if (excludeUserId) recipientIds.delete(excludeUserId);
    if (recipientIds.size === 0) return;

    await this.notifications.queue(
      Array.from(recipientIds).map((recipientId) => ({ schoolId, recipientId, ...payload })),
    );
  }

  private async requireSelf(accessToken: string): Promise<Me> {
    const me = await this.supabase.currentUserRow(accessToken, 'id, role, full_name, school_id') as Me | null;
    if (!me) throw new ForbiddenException('User not found');
    return me;
  }

  private async audit(
    client: ReturnType<SupabaseService['forUser']>,
    accessToken: string,
    schoolId: string,
    action: string,
    entityType: string,
    entityId: string,
    metadata: unknown,
  ) {
    const me = await this.supabase.currentUserRow(accessToken, 'id') as { id: string } | null;
    await client.from('audit_logs').insert({ id: randomUUID(), school_id: schoolId, user_id: me?.id ?? null, action, entity_type: entityType, entity_id: entityId, metadata });
  }
}
