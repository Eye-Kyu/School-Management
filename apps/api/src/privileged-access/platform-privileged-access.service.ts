import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { SupabaseService } from '../supabase/supabase.service';
import { SuperAdminService } from '../super-admin/super-admin.service';
import type { CreatePrivilegedAccessGrantInput, PrivilegedAccessScope } from '@school-manager/types';

const GRANT_COLUMNS =
  'id, super_admin_user_id, target_school_id, reason, reference, access_level, scopes, status, expires_at, ended_at, created_at, school:schools(id, name)';

type GrantRow = {
  id: string;
  super_admin_user_id: string;
  target_school_id: string;
  reason: string;
  reference: string | null;
  access_level: string;
  scopes: string[];
  status: 'ACTIVE' | 'ENDED' | 'EXPIRED';
  expires_at: string;
  ended_at: string | null;
  created_at: string;
  school: { id: string; name: string } | { id: string; name: string }[] | null;
};

@Injectable()
export class PlatformPrivilegedAccessService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly superAdmin: SuperAdminService,
  ) {}

  private async resolveCaller(callerAuthId: string) {
    const { data } = await this.supabase.admin.from('users').select('id, full_name').eq('auth_id', callerAuthId).maybeSingle();
    return data;
  }

  private isExpired(row: Pick<GrantRow, 'status' | 'expires_at'>): boolean {
    return row.status === 'ACTIVE' && new Date(row.expires_at).getTime() <= Date.now();
  }

  /** Flips an overdue-but-still-ACTIVE row to EXPIRED for display — lazy, on read, never relied on for enforcement. */
  private async materialize(row: GrantRow): Promise<GrantRow> {
    if (!this.isExpired(row)) return row;
    const { data } = await this.supabase.admin
      .from('privileged_access_grants')
      .update({ status: 'EXPIRED', updated_at: new Date().toISOString() })
      .eq('id', row.id)
      .eq('status', 'ACTIVE')
      .select(GRANT_COLUMNS)
      .maybeSingle();
    return (data as GrantRow | null) ?? { ...row, status: 'EXPIRED' };
  }

  private toDto(row: GrantRow) {
    const school = Array.isArray(row.school) ? row.school[0] : row.school;
    return {
      id: row.id,
      superAdminUserId: row.super_admin_user_id,
      targetSchoolId: row.target_school_id,
      schoolName: school?.name ?? null,
      reason: row.reason,
      reference: row.reference,
      accessLevel: row.access_level,
      scopes: row.scopes,
      status: row.status,
      expiresAt: row.expires_at,
      endedAt: row.ended_at,
      createdAt: row.created_at,
    };
  }

  async createGrant(input: CreatePrivilegedAccessGrantInput, callerAuthId: string) {
    const caller = await this.resolveCaller(callerAuthId);
    if (!caller) throw new ForbiddenException('Caller not found');

    const { data: school } = await this.supabase.admin.from('schools').select('id').eq('id', input.schoolId).maybeSingle();
    if (!school) throw new NotFoundException('School not found');

    const now = new Date();
    const expiresAt = new Date(now.getTime() + input.durationMinutes * 60 * 1000);

    const { data, error } = await this.supabase.admin
      .from('privileged_access_grants')
      .insert({
        id: randomUUID(),
        super_admin_user_id: caller.id,
        target_school_id: input.schoolId,
        reason: input.reason,
        reference: input.reference ?? null,
        access_level: 'READ_ONLY',
        scopes: input.scopes,
        status: 'ACTIVE',
        expires_at: expiresAt.toISOString(),
        updated_at: now.toISOString(),
      })
      .select(GRANT_COLUMNS)
      .single();
    if (error) throw new BadRequestException(error.message);

    await this.supabase.admin.from('audit_logs').insert({
      id: randomUUID(),
      school_id: input.schoolId,
      user_id: caller.id,
      action: 'privileged_access.grant',
      entity_type: 'privileged_access_grants',
      entity_id: data.id,
      metadata: { reason: input.reason, reference: input.reference ?? null, scopes: input.scopes, expiresAt: data.expires_at },
    });

    return this.toDto(data as GrantRow);
  }

  /** The caller's currently active (unexpired, unended) grant, if any — powers the global banner. */
  async getActiveGrant(callerAuthId: string) {
    const caller = await this.resolveCaller(callerAuthId);
    if (!caller) throw new ForbiddenException('Caller not found');

    const { data, error } = await this.supabase.admin
      .from('privileged_access_grants')
      .select(GRANT_COLUMNS)
      .eq('super_admin_user_id', caller.id)
      .eq('status', 'ACTIVE')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) return null;

    const materialized = await this.materialize(data as GrantRow);
    return materialized.status === 'ACTIVE' ? this.toDto(materialized) : null;
  }

  /** Full grant history, most recent first — powers the Audit & Security page. */
  async listGrants() {
    const { data, error } = await this.supabase.admin
      .from('privileged_access_grants')
      .select(GRANT_COLUMNS)
      .order('created_at', { ascending: false });
    if (error) throw new BadRequestException(error.message);

    const rows = (data as GrantRow[] | null) ?? [];
    const materialized = await Promise.all(rows.map((r) => this.materialize(r)));
    return materialized.map((r) => this.toDto(r));
  }

  async endGrant(grantId: string, callerAuthId: string) {
    const caller = await this.resolveCaller(callerAuthId);
    if (!caller) throw new ForbiddenException('Caller not found');

    const { data: grant } = await this.supabase.admin
      .from('privileged_access_grants')
      .select('id, super_admin_user_id, target_school_id, status')
      .eq('id', grantId)
      .maybeSingle();
    if (!grant) throw new NotFoundException('Grant not found');
    if (grant.super_admin_user_id !== caller.id) throw new ForbiddenException('Only the session owner can end this grant');

    if (grant.status === 'ACTIVE') {
      const now = new Date().toISOString();
      const { error } = await this.supabase.admin
        .from('privileged_access_grants')
        .update({ status: 'ENDED', ended_at: now, updated_at: now })
        .eq('id', grantId);
      if (error) throw new BadRequestException(error.message);

      await this.supabase.admin.from('audit_logs').insert({
        id: randomUUID(),
        school_id: grant.target_school_id,
        user_id: caller.id,
        action: 'privileged_access.end',
        entity_type: 'privileged_access_grants',
        entity_id: grantId,
        metadata: {},
      });
    }

    return { ok: true };
  }

  /**
   * Verifies an active, unexpired, in-scope grant for (caller, school) before
   * any scoped read — this is the actual enforcement point, not RLS. Checks
   * expiry live against `expires_at` regardless of the stored `status`, so a
   * technically-still-ACTIVE row can never grant access past its expiry.
   */
  private async assertActiveGrant(callerAuthId: string, schoolId: string, requiredScope: PrivilegedAccessScope) {
    const caller = await this.resolveCaller(callerAuthId);
    if (!caller) throw new ForbiddenException('Caller not found');

    const { data } = await this.supabase.admin
      .from('privileged_access_grants')
      .select('id, super_admin_user_id, target_school_id, scopes, status, expires_at')
      .eq('super_admin_user_id', caller.id)
      .eq('target_school_id', schoolId)
      .eq('status', 'ACTIVE')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!data) throw new ForbiddenException('No active privileged access grant for this school');
    if (new Date(data.expires_at).getTime() <= Date.now()) {
      await this.supabase.admin
        .from('privileged_access_grants')
        .update({ status: 'EXPIRED', updated_at: new Date().toISOString() })
        .eq('id', data.id)
        .eq('status', 'ACTIVE');
      throw new ForbiddenException('Privileged access grant has expired');
    }
    if (!(data.scopes as string[]).includes(requiredScope)) {
      throw new ForbiddenException(`Grant does not include the '${requiredScope}' scope`);
    }

    return data as { id: string; super_admin_user_id: string; target_school_id: string };
  }

  private async logAccess(grant: { id: string; super_admin_user_id: string; target_school_id: string }, action: string, resourceType: string, scope: PrivilegedAccessScope) {
    await this.supabase.admin.from('privileged_access_logs').insert({
      id: randomUUID(),
      grant_id: grant.id,
      super_admin_user_id: grant.super_admin_user_id,
      target_school_id: grant.target_school_id,
      action,
      resource_type: resourceType,
      resource_id: null,
      scope,
    });
  }

  async getSchoolAggregates(schoolId: string, callerAuthId: string) {
    const grant = await this.assertActiveGrant(callerAuthId, schoolId, 'SCHOOL_AGGREGATES');
    const overview = await this.superAdmin.getSchoolOverview(schoolId);
    await this.logAccess(grant, 'privileged_access.read', 'school_overview', 'SCHOOL_AGGREGATES');
    return overview;
  }

  async getSchoolStudents(schoolId: string, callerAuthId: string) {
    const grant = await this.assertActiveGrant(callerAuthId, schoolId, 'STUDENT_RECORDS');

    const { data, error } = await this.supabase.admin
      .from('students')
      .select(`
        id, admission_no, gender, enrollment_date, is_active, current_class_id,
        user:users!inner(id, full_name, email, phone),
        class:classes!current_class_id(id, name, grade_level)
      `)
      .eq('school_id', schoolId)
      .eq('is_active', true)
      .order('admission_no');
    if (error) throw new BadRequestException(error.message);

    await this.logAccess(grant, 'privileged_access.read', 'students', 'STUDENT_RECORDS');
    return data ?? [];
  }

  /**
   * NOTE: assessments.service.ts's own list() selects `max_marks:max_score`/
   * `assessment_date:date` — those aliases assume column names that do not
   * exist on the live `assessments` table (confirmed live: it has
   * `max_marks`/`assessment_date` directly, no `max_score`/`date`/`kind`/
   * `weight`/`created_by_id` at all). That looks like a real, pre-existing
   * bug in the tenant-facing gradebook feature, unrelated to this task —
   * flagged separately. This method selects the columns that actually exist.
   */
  async getSchoolAcademicData(schoolId: string, callerAuthId: string) {
    const grant = await this.assertActiveGrant(callerAuthId, schoolId, 'ACADEMIC_DATA');

    const { data, error } = await this.supabase.admin
      .from('assessments')
      .select('id, name, max_marks, assessment_date, created_at, term:terms(id, name), class:classes(id, name), subject:subjects(id, name, code)')
      .eq('school_id', schoolId)
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) throw new BadRequestException(error.message);

    await this.logAccess(grant, 'privileged_access.read', 'assessments', 'ACADEMIC_DATA');
    return data ?? [];
  }

  /** Mirrors attendance.service.ts's exportCsv() join shape (names, not bare student_id — the shape a support agent can actually read). */
  async getSchoolAttendance(schoolId: string, callerAuthId: string) {
    const grant = await this.assertActiveGrant(callerAuthId, schoolId, 'ATTENDANCE');

    const { data, error } = await this.supabase.admin
      .from('attendance_records')
      .select('id, date, status, note, student:students!inner(admission_no, user:users!inner(full_name)), class:classes!inner(name)')
      .eq('school_id', schoolId)
      .order('date', { ascending: false })
      .limit(500);
    if (error) throw new BadRequestException(error.message);

    await this.logAccess(grant, 'privileged_access.read', 'attendance_records', 'ATTENDANCE');
    return data ?? [];
  }

  /** Mirrors fees.service.ts's list() — balances, the direct "does this school's fee data look right" view. */
  async getSchoolFinancials(schoolId: string, callerAuthId: string) {
    const grant = await this.assertActiveGrant(callerAuthId, schoolId, 'FINANCIAL_DATA');

    const { data, error } = await this.supabase.admin
      .from('fee_balances')
      .select(`
        id, amount_due, amount_paid, currency, notes, as_of_date, created_at,
        student:students!inner(id, admission_no, user:users!inner(full_name)),
        term:terms(id, name)
      `)
      .eq('school_id', schoolId)
      .order('created_at', { ascending: false });
    if (error) throw new BadRequestException(error.message);

    await this.logAccess(grant, 'privileged_access.read', 'fee_balances', 'FINANCIAL_DATA');
    return data ?? [];
  }

  /** Mirrors the tenant document-library page's own select shape — metadata + the already-public file_url, no signed-URL step needed. */
  async getSchoolDocuments(schoolId: string, callerAuthId: string) {
    const grant = await this.assertActiveGrant(callerAuthId, schoolId, 'DOCUMENTS');

    const { data, error } = await this.supabase.admin
      .from('documents')
      .select('id, title, file_url, file_name, file_size, mime_type, audience, target_grade_level, tags, created_at, uploader:users!uploaded_by_id(full_name)')
      .eq('school_id', schoolId)
      .order('created_at', { ascending: false });
    if (error) throw new BadRequestException(error.message);

    await this.logAccess(grant, 'privileged_access.read', 'documents', 'DOCUMENTS');
    return data ?? [];
  }

  /**
   * Mirrors messaging.service.ts's listConversations() — deliberately MINUS
   * `last_message_body`. Private parent-teacher message content is a higher
   * sensitivity class than the other scopes (a school's own ADMIN has no
   * blanket read access to it either), so this scope is metadata-only:
   * participants, timestamps, flagged status, unread counts — never body text.
   */
  async getSchoolConversations(schoolId: string, callerAuthId: string) {
    const grant = await this.assertActiveGrant(callerAuthId, schoolId, 'COMMUNICATION');

    const { data, error } = await this.supabase.admin
      .from('conversations')
      .select(`
        id, last_message_at, is_flagged, parent_unread_count, teacher_unread_count, created_at, student_id,
        parent:users!parent_user_id(id, full_name),
        teacher:users!teacher_user_id(id, full_name),
        student:students(id, user:users!user_id(full_name))
      `)
      .eq('school_id', schoolId)
      .order('last_message_at', { ascending: false, nullsFirst: false });
    if (error) throw new BadRequestException(error.message);

    await this.logAccess(grant, 'privileged_access.read', 'conversations', 'COMMUNICATION');
    return data ?? [];
  }
}
