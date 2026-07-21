import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { SupabaseService } from '../supabase/supabase.service';
import type { CreateSubjectInput, AssignSubjectInput } from '@school-manager/types';

@Injectable()
export class SubjectsService {
  constructor(private readonly supabase: SupabaseService) {}

  async list(accessToken: string) {
    const client = this.supabase.forUser(accessToken);
    const { data, error } = await client
      .from('subjects')
      .select('*, subject_assignments(id, class_id, teacher_id)')
      .order('name');
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async create(accessToken: string, input: CreateSubjectInput) {
    const client = this.supabase.forUser(accessToken);
    await this.requireAdmin(accessToken);

    const { data: school } = await client.from('schools').select('id').single();
    if (!school) throw new ForbiddenException('No school found');

    const { data, error } = await client
      .from('subjects')
      .insert({
        id: randomUUID(),
        school_id: school.id,
        name: input.name,
        code: input.code,
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();
    if (error) throw new Error(error.message);

    await this.audit(client, accessToken, school.id, 'subject.create', 'subject', data.id, { name: input.name });
    return data;
  }

  async remove(accessToken: string, id: string) {
    const client = this.supabase.forUser(accessToken);
    await this.requireAdmin(accessToken);

    const { data, error } = await client
      .from('subjects')
      .delete()
      .eq('id', id)
      .select('id, school_id')
      .single();
    if (error) throw new Error(error.message);
    if (!data) throw new NotFoundException('Subject not found');

    await this.audit(client, accessToken, data.school_id, 'subject.delete', 'subject', id, {});
    return { deleted: true };
  }

  async assign(accessToken: string, input: AssignSubjectInput) {
    const client = this.supabase.forUser(accessToken);
    await this.requireAdmin(accessToken);

    const { data: school } = await client.from('schools').select('id').single();
    if (!school) throw new ForbiddenException('No school found');

    const { data, error } = await client
      .from('subject_assignments')
      .insert({
        id: randomUUID(),
        class_id: input.classId,
        subject_id: input.subjectId,
        teacher_id: input.teacherId,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);

    await this.audit(client, accessToken, school.id, 'subject_assignment.create', 'subject_assignment', data.id, input);
    return data;
  }

  async unassign(accessToken: string, id: string) {
    const client = this.supabase.forUser(accessToken);
    await this.requireAdmin(accessToken);

    const { data: school } = await client.from('schools').select('id').single();
    const { error } = await client.from('subject_assignments').delete().eq('id', id);
    if (error) throw new Error(error.message);

    if (school) await this.audit(client, accessToken, school.id, 'subject_assignment.delete', 'subject_assignment', id, {});
    return { deleted: true };
  }

  private async requireAdmin(accessToken: string) {
    const role = await this.supabase.getUserRole(accessToken);
    if (role !== 'ADMIN') throw new ForbiddenException('Admin role required');
  }

  private async audit(client: ReturnType<SupabaseService['forUser']>, accessToken: string, schoolId: string, action: string, entityType: string, entityId: string, metadata: unknown) {
    const me = await this.supabase.currentUserRow(accessToken, 'id') as { id: string } | null;
    await client.from('audit_logs').insert({ id: randomUUID(), school_id: schoolId, user_id: me?.id ?? null, action, entity_type: entityType, entity_id: entityId, metadata });
  }
}
