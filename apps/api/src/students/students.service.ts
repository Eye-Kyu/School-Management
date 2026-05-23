import { Injectable, ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { SupabaseService } from '../supabase/supabase.service';
import type { CreateStudentInput, UpdateUserInput } from '@school-manager/types';

@Injectable()
export class StudentsService {
  constructor(private readonly supabase: SupabaseService) {}

  async list(accessToken: string) {
    const client = this.supabase.forUser(accessToken);
    const { data, error } = await client
      .from('students')
      .select(`
        id, admission_no, gender, enrollment_date, is_active, current_class_id,
        user:users!inner(id, full_name, email, phone),
        class:classes(id, name, grade_level)
      `)
      .eq('is_active', true)
      .order('admission_no');
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async create(accessToken: string, input: CreateStudentInput) {
    const client = this.supabase.forUser(accessToken);
    await this.requireAdmin(client);

    const { data: school } = await client.from('schools').select('id').single();
    if (!school) throw new ForbiddenException('No school found');

    if (!input.email && !input.phone) {
      throw new BadRequestException('Student must have either an email or phone number');
    }

    const tempPassword = Math.random().toString(36).slice(-10) + 'Aa1!';
    const { data: authData, error: authError } = await this.supabase.admin.auth.admin.createUser({
      email: input.email,
      phone: input.phone,
      password: tempPassword,
      email_confirm: true,
      user_metadata: {
        school_id: school.id,
        role: 'STUDENT',
        full_name: input.fullName,
      },
    });
    if (authError) throw new BadRequestException(authError.message);

    const authUserId = authData.user.id;
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
        role: 'STUDENT',
        updated_at: new Date().toISOString(),
      }, { onConflict: 'auth_id' });
    if (userError) throw new Error(userError.message);

    const { data: userRow } = await this.supabase.admin
      .from('users').select('id').eq('auth_id', authUserId).single();
    const actualUserId = userRow?.id ?? userId;

    const studentId = randomUUID();
    const { data: student, error: studentError } = await this.supabase.admin
      .from('students')
      .insert({
        id: studentId,
        school_id: school.id,
        user_id: actualUserId,
        admission_no: input.admissionNo,
        date_of_birth: input.dateOfBirth ?? null,
        gender: input.gender ?? null,
        current_class_id: input.classId ?? null,
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();
    if (studentError) throw new Error(studentError.message);

    await this.audit(client, school.id, 'student.create', 'student', studentId, {
      fullName: input.fullName,
      admissionNo: input.admissionNo,
    });

    return { ...student, temporaryPassword: tempPassword };
  }

  async update(accessToken: string, studentId: string, input: UpdateUserInput) {
    const client = this.supabase.forUser(accessToken);
    await this.requireAdmin(client);

    const { data: student } = await client
      .from('students').select('user_id, school_id').eq('id', studentId).maybeSingle();
    if (!student) throw new NotFoundException('Student not found');

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (input.fullName !== undefined) patch.full_name = input.fullName;
    if (input.email !== undefined) patch.email = input.email;
    if (input.phone !== undefined) patch.phone = input.phone;
    if (input.isActive !== undefined) patch.is_active = input.isActive;

    const { error } = await client.from('users').update(patch).eq('id', student.user_id);
    if (error) throw new Error(error.message);

    await this.audit(client, student.school_id, 'student.update', 'student', studentId, patch);
    return { updated: true };
  }

  async softDelete(accessToken: string, studentId: string) {
    const client = this.supabase.forUser(accessToken);
    await this.requireAdmin(client);

    const { data: student } = await client
      .from('students').select('user_id, school_id').eq('id', studentId).maybeSingle();
    if (!student) throw new NotFoundException('Student not found');

    await client.from('users').update({
      deleted_at: new Date().toISOString(),
      is_active: false,
      updated_at: new Date().toISOString(),
    }).eq('id', student.user_id);

    await client.from('students').update({
      is_active: false,
      updated_at: new Date().toISOString(),
    }).eq('id', studentId);

    await this.audit(client, student.school_id, 'student.delete', 'student', studentId, {});
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
