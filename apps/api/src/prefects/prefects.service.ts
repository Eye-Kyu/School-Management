import { Injectable, ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { SupabaseService } from '../supabase/supabase.service';
import { NotificationsService } from '../notifications/notifications.service';
import type {
  AssignClassPrefectInput,
  AssignSchoolPrefectInput,
  SetPrefectPowerInput,
  SubmitBehaviorIncidentInput,
  ReviewBehaviorIncidentInput,
  SendPrefectMessageInput,
} from '@school-manager/types';

type Me = { id: string; role: string; full_name: string; school_id: string | null };

@Injectable()
export class PrefectsService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly notifications: NotificationsService,
  ) {}

  // ── Class Prefects ───────────────────────────────────────────

  async listClassPrefects(accessToken: string) {
    const client = this.supabase.forUser(accessToken);
    await this.requireAdmin(accessToken);

    const { data: classes, error } = await client
      .from('classes').select('id, name, grade_level').eq('is_active', true).order('grade_level').order('name');
    if (error) throw new Error(error.message);

    const { data: prefects } = await client
      .from('class_prefects')
      .select('id, class_id, student_id, term_id, assigned_at, student:students!inner(admission_no, user:users!inner(full_name))')
      .is('revoked_at', null);
    const byClass = new Map((prefects ?? []).map((p) => [p.class_id, p]));

    return (classes ?? []).map((c) => ({ ...c, prefect: byClass.get(c.id) ?? null }));
  }

  async assignClassPrefect(accessToken: string, input: AssignClassPrefectInput) {
    const client = this.supabase.forUser(accessToken);
    const me = await this.requireSelf(accessToken);

    const { data: teacherRow } = await client
      .from('teachers').select('id, school_id, is_class_teacher_of').eq('user_id', me.id).maybeSingle();
    if (!teacherRow) throw new ForbiddenException('Teacher record not found');
    if (teacherRow.is_class_teacher_of !== input.classId) {
      throw new ForbiddenException('You are not the class teacher of this class');
    }

    const { data: student } = await client.from('students').select('id, current_class_id').eq('id', input.studentId).maybeSingle();
    if (!student) throw new NotFoundException('Student not found');
    if (student.current_class_id !== input.classId) {
      throw new BadRequestException('Student is not enrolled in this class');
    }

    const { data, error } = await client
      .from('class_prefects')
      .insert({
        id: randomUUID(), school_id: teacherRow.school_id, class_id: input.classId,
        student_id: input.studentId, term_id: input.termId, assigned_by_user_id: me.id,
      })
      .select().single();
    if (error) {
      if (error.code === '23505') throw new BadRequestException('This class already has an active prefect for that term');
      throw new Error(error.message);
    }

    await this.audit(client, accessToken, teacherRow.school_id, 'prefect.assign_class', 'class_prefect', data.id, {
      class_id: input.classId, student_id: input.studentId, term_id: input.termId,
    });
    return data;
  }

  async revokeClassPrefect(accessToken: string, prefectId: string, reason?: string) {
    const client = this.supabase.forUser(accessToken);
    const me = await this.requireSelf(accessToken);

    const { data, error } = await client
      .from('class_prefects')
      .update({ revoked_at: new Date().toISOString(), revoked_by_user_id: me.id, revocation_reason: reason ?? null })
      .eq('id', prefectId).is('revoked_at', null)
      .select().single();
    if (error) throw new Error(error.message);
    if (!data) throw new NotFoundException('Active prefect record not found');

    await this.audit(client, accessToken, data.school_id, 'prefect.revoke_class', 'class_prefect', prefectId, { reason: reason ?? null });
    return data;
  }

  // Revoke-then-assign, sequential — this codebase has no cross-table
  // transaction primitive; matches ClassesService.setClassTeacher's
  // established "null old, then set new" ordering for the same reason.
  async changeClassPrefect(accessToken: string, classId: string, newStudentId: string, termId: string | null, reason: string) {
    const client = this.supabase.forUser(accessToken);
    const { data: existing } = await client
      .from('class_prefects').select('id').eq('class_id', classId).is('revoked_at', null).maybeSingle();
    if (existing) await this.revokeClassPrefect(accessToken, existing.id, reason);
    return this.assignClassPrefect(accessToken, { classId, studentId: newStudentId, termId });
  }

  // ── School Prefects ──────────────────────────────────────────

  async listSchoolPrefects(accessToken: string) {
    const { data, error } = await this.supabase.forUser(accessToken)
      .from('school_prefects')
      .select('id, student_id, role_title, term_id, assigned_at, revoked_at, revocation_reason, student:students!inner(admission_no, user:users!inner(full_name))')
      .order('assigned_at', { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async assignSchoolPrefect(accessToken: string, input: AssignSchoolPrefectInput) {
    const client = this.supabase.forUser(accessToken);
    await this.requireAdmin(accessToken);
    const me = await this.requireSelf(accessToken);
    if (!me.school_id) throw new ForbiddenException('No school found for this user');

    const { data: student } = await client.from('students').select('id').eq('id', input.studentId).maybeSingle();
    if (!student) throw new NotFoundException('Student not found');

    const { data, error } = await client
      .from('school_prefects')
      .insert({
        id: randomUUID(), school_id: me.school_id, student_id: input.studentId,
        role_title: input.roleTitle, term_id: input.termId, assigned_by_user_id: me.id,
      })
      .select().single();
    if (error) throw new Error(error.message);

    await this.audit(client, accessToken, me.school_id, 'prefect.assign_school', 'school_prefect', data.id, {
      student_id: input.studentId, role_title: input.roleTitle, term_id: input.termId,
    });
    return data;
  }

  async revokeSchoolPrefect(accessToken: string, prefectId: string, reason?: string) {
    const client = this.supabase.forUser(accessToken);
    await this.requireAdmin(accessToken);
    const me = await this.requireSelf(accessToken);

    const { data, error } = await client
      .from('school_prefects')
      .update({ revoked_at: new Date().toISOString(), revoked_by_user_id: me.id, revocation_reason: reason ?? null })
      .eq('id', prefectId).is('revoked_at', null)
      .select().single();
    if (error) throw new Error(error.message);
    if (!data) throw new NotFoundException('Active prefect record not found');

    await this.audit(client, accessToken, data.school_id, 'prefect.revoke_school', 'school_prefect', prefectId, { reason: reason ?? null });
    return data;
  }

  // ── Prefect powers ───────────────────────────────────────────

  async listPrefectPowers(accessToken: string) {
    const { data, error } = await this.supabase.forUser(accessToken)
      .from('prefect_powers').select('id, power_code, applies_to, enabled, updated_at').order('applies_to').order('power_code');
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async setPrefectPower(accessToken: string, input: SetPrefectPowerInput) {
    const client = this.supabase.forUser(accessToken);
    await this.requireAdmin(accessToken);
    const me = await this.requireSelf(accessToken);
    if (!me.school_id) throw new ForbiddenException('No school found for this user');

    const { data, error } = await client
      .from('prefect_powers')
      .update({ enabled: input.enabled, updated_at: new Date().toISOString(), updated_by_user_id: me.id })
      .eq('school_id', me.school_id).eq('power_code', input.powerCode)
      .select().single();
    if (error) throw new Error(error.message);
    if (!data) throw new NotFoundException('Power not found');

    await this.audit(client, accessToken, me.school_id, 'prefect.power_toggle', 'prefect_power', data.id, {
      power_code: input.powerCode, enabled: input.enabled,
    });
    return data;
  }

  // ── My prefect status (frontend affordance gating) ──────────

  async myPrefectStatus(accessToken: string) {
    const client = this.supabase.forUser(accessToken);
    const me = await this.supabase.currentUserRow(accessToken, 'id, role') as { id: string; role: string } | null;
    const empty = { classPrefect: null, schoolPrefects: [] as unknown[], powers: {} as Record<string, boolean> };
    if (!me || me.role !== 'STUDENT') return empty;

    const { data: studentRow } = await client.from('students').select('id, school_id').eq('user_id', me.id).maybeSingle();
    if (!studentRow) return empty;

    const [{ data: classPrefect }, { data: schoolPrefects }, { data: powers }] = await Promise.all([
      client.from('class_prefects').select('id, class_id, term_id').eq('student_id', studentRow.id).is('revoked_at', null).maybeSingle(),
      client.from('school_prefects').select('id, role_title, term_id').eq('student_id', studentRow.id).is('revoked_at', null),
      client.from('prefect_powers').select('power_code, enabled').eq('school_id', studentRow.school_id),
    ]);

    const powerMap: Record<string, boolean> = {};
    for (const p of powers ?? []) powerMap[p.power_code] = p.enabled;

    return { classPrefect: classPrefect ?? null, schoolPrefects: schoolPrefects ?? [], powers: powerMap };
  }

  // ── Behavior incident reports ────────────────────────────────

  async submitBehaviorIncident(accessToken: string, input: SubmitBehaviorIncidentInput) {
    const client = this.supabase.forUser(accessToken);
    const me = await this.requireSelf(accessToken);
    if (me.role !== 'STUDENT' || !me.school_id) throw new ForbiddenException('Only a prefect can report a behavior incident');

    const { data, error } = await client
      .from('behavior_incident_reports')
      .insert({
        id: randomUUID(), school_id: me.school_id, reported_by_user_id: me.id,
        student_id: input.studentId, category: input.category, description: input.description,
      })
      .select().single();
    // RLS enforces "active prefect + power enabled + in-scope student" at the
    // DB level — a denial surfaces as a Postgres permission error, not a
    // clean 403; translate it to one here.
    if (error) throw new ForbiddenException("You don't have permission to report this incident — check your prefect status and the school's power settings");

    await this.audit(client, accessToken, me.school_id, 'behavior_incident.submit', 'behavior_incident_report', data.id, {
      student_id: input.studentId, category: input.category,
    });

    const { data: targetStudent } = await client.from('students').select('current_class_id').eq('id', input.studentId).maybeSingle();
    if (targetStudent?.current_class_id) {
      const { data: classTeacher } = await this.supabase.admin
        .from('teachers').select('user_id').eq('is_class_teacher_of', targetStudent.current_class_id).maybeSingle();
      if (classTeacher) {
        await this.notifications.queue([{
          schoolId: me.school_id, recipientId: classTeacher.user_id, type: 'BEHAVIOR_INCIDENT_SUBMITTED',
          title: 'New behavior incident report', body: 'A prefect submitted a behavior report for your review.',
          metadata: { reportId: data.id, studentId: input.studentId },
        }]);
      }
    }

    return data;
  }

  async reviewBehaviorIncident(accessToken: string, reportId: string, input: ReviewBehaviorIncidentInput) {
    const client = this.supabase.forUser(accessToken);
    const me = await this.requireSelf(accessToken);

    const { data: report } = await client
      .from('behavior_incident_reports')
      .select('id, school_id, student_id, reported_by_user_id, status, category')
      .eq('id', reportId).maybeSingle();
    if (!report) throw new NotFoundException('Report not found');
    if (report.status !== 'PENDING') throw new BadRequestException('This report has already been reviewed');

    const newStatus = input.action === 'DISMISS' ? 'DISMISSED' : 'REVIEWED';
    const { error } = await client
      .from('behavior_incident_reports')
      .update({
        status: newStatus, reviewed_by_user_id: me.id, reviewed_at: new Date().toISOString(),
        class_teacher_notes: input.classTeacherNotes ?? null, updated_at: new Date().toISOString(),
      })
      .eq('id', reportId);
    if (error) throw new Error(error.message);

    let convertedToPoints = false;
    if (input.convertToPoints) {
      const { data: teacherRow } = await client.from('teachers').select('id').eq('user_id', me.id).maybeSingle();
      if (teacherRow) {
        const { error: bpError } = await client.from('behaviour_points').insert({
          id: randomUUID(), school_id: report.school_id, student_id: report.student_id, teacher_id: teacherRow.id,
          category: input.convertToPoints.category, points: input.convertToPoints.points,
          reason: input.convertToPoints.reason, reason_category: report.category,
        });
        if (!bpError) convertedToPoints = true;
      }
    }

    await this.audit(client, accessToken, report.school_id, 'behavior_incident.review', 'behavior_incident_report', reportId, {
      action: input.action, converted_to_points: convertedToPoints,
    });

    await this.notifications.queue([{
      schoolId: report.school_id, recipientId: report.reported_by_user_id, type: 'BEHAVIOR_INCIDENT_REVIEWED',
      title: newStatus === 'DISMISSED' ? 'Your report was dismissed' : 'Your report was reviewed',
      body: input.classTeacherNotes || 'Your Class Teacher has reviewed your behavior incident report.',
      metadata: { reportId },
    }]);

    return { updated: true, convertedToPoints };
  }

  // ── Prefect messaging — one-way notification, never a real conversation ──
  // (Students are unconditionally blocked from `conversations`/`messages`
  // participation by a DB trigger — see 20260723000038_admin_teacher_messaging.sql.
  // This deliberately never touches that boundary.)

  async sendPrefectMessage(accessToken: string, target: 'CLASS_TEACHER' | 'ADMIN', input: SendPrefectMessageInput) {
    const client = this.supabase.forUser(accessToken);
    const me = await this.requireSelf(accessToken);
    if (me.role !== 'STUDENT' || !me.school_id) throw new ForbiddenException('Only a prefect can send this message');

    const { data: studentRow } = await client.from('students').select('id, school_id').eq('user_id', me.id).maybeSingle();
    if (!studentRow) throw new ForbiddenException('Student record not found');

    const powerCode = target === 'CLASS_TEACHER' ? 'compose_message_to_class_teacher' : 'compose_message_to_admin';
    const { data: power } = await client
      .from('prefect_powers').select('enabled').eq('school_id', studentRow.school_id).eq('power_code', powerCode).maybeSingle();
    if (!power?.enabled) throw new ForbiddenException('This power is not enabled for your school');

    let recipientIds: string[] = [];
    if (target === 'CLASS_TEACHER') {
      const { data: cp } = await client
        .from('class_prefects').select('class_id').eq('student_id', studentRow.id).is('revoked_at', null).maybeSingle();
      if (!cp) throw new ForbiddenException('You are not an active Class Prefect');
      const { data: teacher } = await this.supabase.admin
        .from('teachers').select('user_id').eq('is_class_teacher_of', cp.class_id).maybeSingle();
      if (!teacher) throw new NotFoundException('No Class Teacher assigned to your class');
      recipientIds = [teacher.user_id];
    } else {
      const { data: sp } = await client
        .from('school_prefects').select('id').eq('student_id', studentRow.id).is('revoked_at', null).maybeSingle();
      if (!sp) throw new ForbiddenException('You are not an active School Prefect');
      const { data: admins } = await this.supabase.admin
        .from('users').select('id').eq('school_id', studentRow.school_id).eq('role', 'ADMIN').eq('is_active', true).is('deleted_at', null);
      recipientIds = (admins ?? []).map((a) => a.id);
    }

    await this.notifications.queue(recipientIds.map((recipientId) => ({
      schoolId: studentRow.school_id, recipientId, type: 'PREFECT_MESSAGE' as const,
      title: `Message from ${me.full_name}`, body: input.body,
      metadata: { fromUserId: me.id, fromName: me.full_name },
    })));

    return { sent: true, recipientCount: recipientIds.length };
  }

  private async requireAdmin(accessToken: string) {
    const role = await this.supabase.getUserRole(accessToken);
    if (role !== 'ADMIN') throw new ForbiddenException('Admin role required');
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
    await client.from('audit_logs').insert({
      id: randomUUID(), school_id: schoolId, user_id: me?.id ?? null,
      action, entity_type: entityType, entity_id: entityId, metadata,
    });
  }
}
