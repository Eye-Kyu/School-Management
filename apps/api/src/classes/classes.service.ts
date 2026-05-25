import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { SupabaseService } from '../supabase/supabase.service';
import type { CreateClassInput, UpdateClassInput } from '@school-manager/types';

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

    await this.requireAdmin(client);

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

    await this.audit(client, school.id, 'class.create', 'class', data.id, { name: input.name });
    return data;
  }

  async update(accessToken: string, id: string, input: UpdateClassInput) {
    const client = this.supabase.forUser(accessToken);
    await this.requireAdmin(client);

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

    await this.audit(client, data.school_id, 'class.update', 'class', id, patch);
    return data;
  }

  async softDelete(accessToken: string, id: string) {
    const client = this.supabase.forUser(accessToken);
    await this.requireAdmin(client);

    const { data, error } = await client
      .from('classes')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('id, school_id')
      .single();
    if (error) throw new Error(error.message);
    if (!data) throw new NotFoundException('Class not found');

    await this.audit(client, data.school_id, 'class.delete', 'class', id, {});
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

    await this.audit(client, teacherRecord.school_id, 'class.set_prefect', 'class', classId, { studentId });
    return { updated: true };
  }

  private async requireAdmin(client: ReturnType<SupabaseService['forUser']>) {
    const { data } = await client.from('users').select('role').maybeSingle();
    if (data?.role !== 'ADMIN') throw new ForbiddenException('Admin role required');
  }

  private async audit(
    client: ReturnType<SupabaseService['forUser']>,
    schoolId: string,
    action: string,
    entityType: string,
    entityId: string,
    metadata: unknown,
  ) {
    const { data: me } = await client.from('users').select('id').maybeSingle();
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
