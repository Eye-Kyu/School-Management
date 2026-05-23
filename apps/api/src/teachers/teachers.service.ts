import { Injectable, ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { SupabaseService } from '../supabase/supabase.service';
import type { CreateTeacherInput, UpdateUserInput } from '@school-manager/types';

@Injectable()
export class TeachersService {
  constructor(private readonly supabase: SupabaseService) {}

  async list(accessToken: string) {
    const client = this.supabase.forUser(accessToken);
    const { data, error } = await client
      .from('teachers')
      .select(`
        id, staff_no, created_at,
        user:users!inner(id, full_name, email, phone, is_active)
      `)
      .order('created_at');
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async create(accessToken: string, input: CreateTeacherInput) {
    const client = this.supabase.forUser(accessToken);
    await this.requireAdmin(client);

    const { data: school } = await client.from('schools').select('id').single();
    if (!school) throw new ForbiddenException('No school found');

    if (!input.email && !input.phone) {
      throw new BadRequestException('Teacher must have either an email or phone number');
    }

    // 1. Create the Supabase auth user (admin client bypasses RLS)
    const tempPassword = Math.random().toString(36).slice(-10) + 'Aa1!';
    const { data: authData, error: authError } = await this.supabase.admin.auth.admin.createUser({
      email: input.email,
      phone: input.phone,
      password: tempPassword,
      email_confirm: true,
      user_metadata: {
        school_id: school.id,
        role: 'TEACHER',
        full_name: input.fullName,
      },
    });
    if (authError) throw new BadRequestException(authError.message);

    const authUserId = authData.user.id;

    // 2. Upsert the public.users row (trigger may have already created it)
    const userId = randomUUID();
    const { error: userError } = await this.supabase.admin
      .from('users')
      .upsert({
        id: userId,
        school_id: school.id,
        auth_id: authUserId,
        email: input.email ?? null,
        phone: input.phone ?? null,
        full_name: input.fullName,
        role: 'TEACHER',
        updated_at: new Date().toISOString(),
      }, { onConflict: 'auth_id' });
    if (userError) throw new Error(userError.message);

    // Get the actual user id (may differ if trigger created it first)
    const { data: userRow } = await this.supabase.admin
      .from('users')
      .select('id')
      .eq('auth_id', authUserId)
      .single();

    const actualUserId = userRow?.id ?? userId;

    // 3. Create the teachers profile row
    const teacherId = randomUUID();
    const { data: teacher, error: teacherError } = await this.supabase.admin
      .from('teachers')
      .insert({
        id: teacherId,
        school_id: school.id,
        user_id: actualUserId,
        staff_no: input.staffNo,
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();
    if (teacherError) throw new Error(teacherError.message);

    await this.audit(client, school.id, 'teacher.create', 'teacher', teacherId, {
      fullName: input.fullName,
      staffNo: input.staffNo,
    });

    return { ...teacher, temporaryPassword: tempPassword };
  }

  async update(accessToken: string, teacherId: string, input: UpdateUserInput) {
    const client = this.supabase.forUser(accessToken);
    await this.requireAdmin(client);

    const { data: teacher } = await client
      .from('teachers')
      .select('user_id, school_id')
      .eq('id', teacherId)
      .maybeSingle();
    if (!teacher) throw new NotFoundException('Teacher not found');

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (input.fullName !== undefined) patch.full_name = input.fullName;
    if (input.email !== undefined) patch.email = input.email;
    if (input.phone !== undefined) patch.phone = input.phone;
    if (input.isActive !== undefined) patch.is_active = input.isActive;

    const { error } = await client.from('users').update(patch).eq('id', teacher.user_id);
    if (error) throw new Error(error.message);

    await this.audit(client, teacher.school_id, 'teacher.update', 'teacher', teacherId, patch);
    return { updated: true };
  }

  async softDelete(accessToken: string, teacherId: string) {
    const client = this.supabase.forUser(accessToken);
    await this.requireAdmin(client);

    const { data: teacher } = await client
      .from('teachers')
      .select('user_id, school_id')
      .eq('id', teacherId)
      .maybeSingle();
    if (!teacher) throw new NotFoundException('Teacher not found');

    await client.from('users').update({
      deleted_at: new Date().toISOString(),
      is_active: false,
      updated_at: new Date().toISOString(),
    }).eq('id', teacher.user_id);

    await this.audit(client, teacher.school_id, 'teacher.delete', 'teacher', teacherId, {});
    return { deleted: true };
  }

  private async requireAdmin(client: ReturnType<SupabaseService['forUser']>) {
    const { data } = await client.from('users').select('role').maybeSingle();
    if (data?.role !== 'ADMIN') throw new ForbiddenException('Admin role required');
  }

  private async audit(client: ReturnType<SupabaseService['forUser']>, schoolId: string, action: string, entityType: string, entityId: string, metadata: unknown) {
    const { data: me } = await client.from('users').select('id').maybeSingle();
    await client.from('audit_logs').insert({ id: randomUUID(), school_id: schoolId, user_id: me?.id ?? null, action, entity_type: entityType, entity_id: entityId, metadata });
  }
}
