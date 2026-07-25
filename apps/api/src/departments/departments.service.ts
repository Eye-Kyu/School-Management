import { Injectable, ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { SupabaseService } from '../supabase/supabase.service';
import type { CreateDepartmentInput, UpdateDepartmentInput } from '@school-manager/types';

@Injectable()
export class DepartmentsService {
  constructor(private readonly supabase: SupabaseService) {}

  async list(accessToken: string) {
    const client = this.supabase.forUser(accessToken);
    // RLS now lets ADMIN see soft-deleted rows too (needed so an admin's own
    // delete request can return its own RETURNING row) — filter them out of
    // the normal list explicitly.
    const { data, error } = await client
      .from('departments')
      .select('*, teachers(count), head:users!department_head_user_id(id, full_name)')
      .is('deleted_at', null)
      .order('name');
    if (error) throw new Error(error.message);
    return (data ?? []).map((d) => ({
      ...d,
      teacher_count: (d as unknown as { teachers: { count: number }[] }).teachers?.[0]?.count ?? 0,
      teachers: undefined,
    }));
  }

  // The Department Head must be a Teacher belonging to this department, and
  // may head at most one department. Both checks require a cross-table
  // lookup, so they live here rather than as a declarative CHECK constraint —
  // see the migration comment for why a trigger was deliberately avoided too.
  async setHead(accessToken: string, departmentId: string, teacherUserId: string | null) {
    const client = this.supabase.forUser(accessToken);
    await this.requireAdmin(accessToken);

    const { data: department } = await client.from('departments').select('id, school_id, department_head_user_id').eq('id', departmentId).maybeSingle();
    if (!department) throw new NotFoundException('Department not found');

    if (teacherUserId) {
      const { data: teacherRow } = await client.from('teachers').select('id, department_id').eq('user_id', teacherUserId).maybeSingle();
      if (!teacherRow) throw new BadRequestException('Target user is not a teacher at this school');
      if (teacherRow.department_id !== departmentId) {
        throw new BadRequestException('The Department Head must be a teacher belonging to this department');
      }

      const { data: existingHeadOf } = await client
        .from('departments').select('id, name').eq('department_head_user_id', teacherUserId).neq('id', departmentId).maybeSingle();
      if (existingHeadOf) {
        throw new BadRequestException(`This teacher is already Head of ${existingHeadOf.name} — one person may head at most one department`);
      }
    }

    const { data, error } = await client
      .from('departments')
      .update({ department_head_user_id: teacherUserId, updated_at: new Date().toISOString() })
      .eq('id', departmentId)
      .select()
      .single();
    if (error) throw new Error(error.message);

    await this.audit(client, accessToken, department.school_id, 'department.set_head', 'department', departmentId, {
      previous_head_user_id: department.department_head_user_id ?? null,
      new_head_user_id: teacherUserId,
    });
    return data;
  }

  async create(accessToken: string, input: CreateDepartmentInput) {
    const client = this.supabase.forUser(accessToken);
    await this.requireAdmin(accessToken);

    const { data: school } = await client.from('schools').select('id').single();
    if (!school) throw new ForbiddenException('No school found');

    const { data, error } = await client
      .from('departments')
      .insert({
        id: randomUUID(),
        school_id: school.id,
        name: input.name,
        description: input.description ?? null,
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();
    if (error) throw new Error(error.message);

    await this.audit(client, accessToken, school.id, 'department.create', 'department', data.id, { name: input.name });
    return data;
  }

  async update(accessToken: string, id: string, input: UpdateDepartmentInput) {
    const client = this.supabase.forUser(accessToken);
    await this.requireAdmin(accessToken);

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (input.name !== undefined) patch.name = input.name;
    if (input.description !== undefined) patch.description = input.description;

    const { data, error } = await client
      .from('departments')
      .update(patch)
      .eq('id', id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    if (!data) throw new NotFoundException('Department not found');

    await this.audit(client, accessToken, data.school_id, 'department.update', 'department', id, patch);
    return data;
  }

  // Soft delete — nulls out department_id on affected teachers as an
  // explicit second step (not a DB trigger: a trigger performing this
  // nested cross-table write was confirmed, empirically, to make Postgres
  // reject the outer departments UPDATE itself under RLS — see
  // 20260723000048_fix_department_soft_delete_trigger.sql for the full story).
  async remove(accessToken: string, id: string) {
    const client = this.supabase.forUser(accessToken);
    await this.requireAdmin(accessToken);

    const { data, error } = await client
      .from('departments')
      .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('id, school_id')
      .single();
    if (error) throw new Error(error.message);
    if (!data) throw new NotFoundException('Department not found');

    const { error: nullOutErr } = await client
      .from('teachers')
      .update({ department_id: null })
      .eq('department_id', id);
    if (nullOutErr) throw new Error(nullOutErr.message);

    await this.audit(client, accessToken, data.school_id, 'department.delete', 'department', id, {});
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
