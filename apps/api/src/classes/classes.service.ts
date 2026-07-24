import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { SupabaseService } from '../supabase/supabase.service';
import type { CreateClassInput, UpdateClassInput } from '@school-manager/types';
import type { AssistModeClaims } from '../common/assist-mode';

@Injectable()
export class ClassesService {
  constructor(private readonly supabase: SupabaseService) {}

  async list(accessToken: string) {
    const client = this.supabase.forUser(accessToken);
    const { data, error } = await client
      .from('classes')
      .select('*')
      .eq('is_active', true)
      .order('grade_level')
      .order('name');
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async create(accessToken: string, input: CreateClassInput) {
    const client = this.supabase.forUser(accessToken);

    await this.requireAdmin(accessToken);

    const { data: school } = await client
      .from('schools')
      .select('id')
      .single();
    if (!school) throw new ForbiddenException('No school found for this user');

    const { data, error } = await client
      .from('classes')
      .insert({
        id: randomUUID(),
        school_id: school.id,
        name: input.name,
        grade_level: input.gradeLevel,
        stream: input.stream ?? null,
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();
    if (error) throw new Error(error.message);

    await this.audit(client, accessToken, school.id, 'class.create', 'class', data.id, { name: input.name });
    return data;
  }

  async update(accessToken: string, id: string, input: UpdateClassInput) {
    const client = this.supabase.forUser(accessToken);
    await this.requireAdmin(accessToken);

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (input.name !== undefined) patch.name = input.name;
    if (input.gradeLevel !== undefined) patch.grade_level = input.gradeLevel;
    if (input.stream !== undefined) patch.stream = input.stream;

    const { data, error } = await client
      .from('classes')
      .update(patch)
      .eq('id', id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    if (!data) throw new NotFoundException('Class not found');

    await this.audit(client, accessToken, data.school_id, 'class.update', 'class', id, patch);
    return data;
  }

  async softDelete(accessToken: string, id: string) {
    const client = this.supabase.forUser(accessToken);
    await this.requireAdmin(accessToken);

    const { data, error } = await client
      .from('classes')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('id, school_id')
      .single();
    if (error) throw new Error(error.message);
    if (!data) throw new NotFoundException('Class not found');

    await this.audit(client, accessToken, data.school_id, 'class.delete', 'class', id, {});
    return { deleted: true };
  }

  async setPrefect(accessToken: string, authUserId: string, classId: string, studentId: string | null) {
    const client = this.supabase.forUser(accessToken);

    const { data: teacherRecord } = await client
      .from('teachers')
      .select('id, school_id, is_class_teacher_of, user:users!inner(auth_id)')
      .eq('users.auth_id', authUserId)
      .maybeSingle();

    if (!teacherRecord) throw new ForbiddenException('Teacher record not found');
    if (teacherRecord.is_class_teacher_of !== classId) {
      throw new ForbiddenException('You are not the class teacher of this class');
    }

    const { error } = await client
      .from('classes')
      .update({ prefect_student_id: studentId, updated_at: new Date().toISOString() })
      .eq('id', classId);
    if (error) throw new Error(error.message);

    await this.audit(client, accessToken, teacherRecord.school_id, 'class.set_prefect', 'class', classId, { studentId });
    return { updated: true };
  }

  async setClassTeacher(accessToken: string, classId: string, teacherId: string | null, assistContext?: AssistModeClaims) {
    // ASSIST MODE: RLS bypassed intentionally, school_id filter enforced at
    // app layer. AssistScopeGuard already re-verified the grant is ACTIVE and
    // includes ACADEMIC_DATA before this method runs — a real ADMIN role
    // check would otherwise reject the SuperAdmin's own SUPER_ADMIN role.
    const client = assistContext ? this.supabase.admin : this.supabase.forUser(accessToken);
    if (!assistContext) await this.requireAdmin(accessToken);

    const { data: classRow } = await client
      .from('classes')
      .select('id, school_id')
      .eq('id', classId)
      .maybeSingle();
    if (!classRow) throw new NotFoundException('Class not found');
    // A cross-school class id smuggled into the URL while in assist mode
    // must 404 exactly like RLS would for a normal caller, never resolve.
    if (assistContext && classRow.school_id !== assistContext.targetSchoolId) {
      throw new NotFoundException('Class not found');
    }

    if (teacherId) {
      // RLS (teachers_select_same_school) already hides a cross-school
      // teacher row for a normal caller, so a bad/foreign id naturally 404s.
      // In assist mode (service-role client, RLS bypassed) the same check is
      // done explicitly below.
      const { data: targetTeacher } = await client
        .from('teachers')
        .select('id, school_id')
        .eq('id', teacherId)
        .maybeSingle();
      if (!targetTeacher) throw new NotFoundException('Teacher not found');
      if (assistContext && targetTeacher.school_id !== assistContext.targetSchoolId) {
        throw new NotFoundException('Teacher not found');
      }
    }

    const { data: currentClassTeacher } = await client
      .from('teachers')
      .select('id')
      .eq('is_class_teacher_of', classId)
      .maybeSingle();
    const previousTeacherId: string | null = currentClassTeacher?.id ?? null;

    const now = new Date().toISOString();

    // Null the previous class teacher FIRST — teachers_class_teacher_unique
    // (one class teacher per class) would otherwise reject setting the new
    // teacher while the old one still points at this class.
    if (previousTeacherId && previousTeacherId !== teacherId) {
      await client.from('teachers').update({ is_class_teacher_of: null, updated_at: now }).eq('id', previousTeacherId);
    }

    if (teacherId) {
      // Overwriting is_class_teacher_of also displaces this teacher from
      // whatever OTHER class they were previously class teacher of, if any —
      // it's a single column, so there's nothing extra to null out for that.
      const { error } = await client
        .from('teachers')
        .update({ is_class_teacher_of: classId, updated_at: now })
        .eq('id', teacherId);
      if (error) throw new Error(error.message);
    }

    await this.audit(client, accessToken, classRow.school_id, 'class.set_class_teacher', 'class', classId, {
      class_id: classId,
      previous_teacher_id: previousTeacherId,
      new_teacher_id: teacherId,
    });
    // The generic assist.* audit row (super_admin_user_id/target_school_id/
    // access_grant_id) is written by AssistAuditInterceptor for every
    // mutating request made under an active assist context — no per-service
    // duplication needed.
    return { updated: true };
  }

  private async requireAdmin(accessToken: string) {
    const role = await this.supabase.getUserRole(accessToken);
    if (role !== 'ADMIN') throw new ForbiddenException('Admin role required');
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
      id: randomUUID(),
      school_id: schoolId,
      user_id: me?.id ?? null,
      action,
      entity_type: entityType,
      entity_id: entityId,
      metadata,
    });
  }
}
