import { Injectable, ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { SupabaseService } from '../supabase/supabase.service';
import type { CreateStudentInput, UpdateUserInput, PromoteStudentsInput } from '@school-manager/types';
import { StudentCsvRow } from '@school-manager/types';

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
        class:classes!current_class_id(id, name, grade_level)
      `)
      .eq('is_active', true)
      .order('admission_no');
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async create(accessToken: string, input: CreateStudentInput) {
    const client = this.supabase.forUser(accessToken);
    await this.requireAdmin(accessToken);

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

    await this.audit(client, accessToken, school.id, 'student.create', 'student', studentId, {
      fullName: input.fullName,
      admissionNo: input.admissionNo,
    });

    return { ...student, temporaryPassword: tempPassword };
  }

  async update(accessToken: string, studentId: string, input: UpdateUserInput) {
    const client = this.supabase.forUser(accessToken);
    await this.requireAdmin(accessToken);

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

    await this.audit(client, accessToken, student.school_id, 'student.update', 'student', studentId, patch);
    return { updated: true };
  }

  async softDelete(accessToken: string, studentId: string) {
    const client = this.supabase.forUser(accessToken);
    await this.requireAdmin(accessToken);

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

    await this.audit(client, accessToken, student.school_id, 'student.delete', 'student', studentId, {});
    return { deleted: true };
  }

  async importCsv(accessToken: string, callerAuthId: string, csvText: string) {
    const client = this.supabase.forUser(accessToken);
    await this.requireAdmin(accessToken);

    const { data: school } = await client.from('schools').select('id').single();
    if (!school) throw new ForbiddenException('No school found');

    const { data: callerRow } = await client
      .from('users').select('id').eq('auth_id', callerAuthId).maybeSingle();

    const lines = csvText.trim().split('\n').filter(Boolean);
    if (lines.length < 2) throw new BadRequestException('CSV must have a header row and at least one data row');

    const headerLine = lines[0] as string;
    const header = headerLine.replace(/^\ufeff/, '').split(',').map(h => h.trim().toLowerCase().replace(/\s+/g, ''));
    for (const h of ['admissionno', 'fullname', 'classname']) {
      if (!header.includes(h)) throw new BadRequestException(`Missing required column: ${h}`);
    }

    type RowResult = { row: number; result: 'ok' | 'error'; admissionNo?: string; tempEmail?: string; tempPassword?: string; message?: string };
    const rows: RowResult[] = [];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i] as string;
      const values = line.split(',').map(v => v.trim());
      const raw: Record<string, string> = {};
      header.forEach((h, idx) => { raw[h] = values[idx] ?? ''; });

      const parsed = StudentCsvRow.safeParse({
        admissionNo: raw.admissionno,
        fullName: raw.fullname,
        className: raw.classname,
        dateOfBirth: raw.dateofbirth || undefined,
        gender: raw.gender?.toUpperCase() || undefined,
      });
      if (!parsed.success) {
        rows.push({ row: i + 1, result: 'error', message: parsed.error.issues[0]?.message });
        continue;
      }

      const { data: classRow } = await this.supabase.admin
        .from('classes')
        .select('id')
        .eq('school_id', school.id)
        .eq('name', parsed.data.className)
        .maybeSingle();
      if (!classRow) {
        rows.push({ row: i + 1, result: 'error', admissionNo: parsed.data.admissionNo, message: `Class "${parsed.data.className}" not found` });
        continue;
      }

      const { data: existing } = await this.supabase.admin
        .from('students')
        .select('id')
        .eq('school_id', school.id)
        .eq('admission_no', parsed.data.admissionNo)
        .maybeSingle();
      if (existing) {
        rows.push({ row: i + 1, result: 'error', admissionNo: parsed.data.admissionNo, message: `Admission number ${parsed.data.admissionNo} already exists` });
        continue;
      }

      // Generate placeholder credentials — admin updates contact info later
      const safeAdm = parsed.data.admissionNo.toLowerCase().replace(/[^a-z0-9]/g, '');
      const tempEmail = `${safeAdm}@students.placeholder`;
      const tempPassword = Math.random().toString(36).slice(-10) + 'Aa1!';

      const { data: authData, error: authError } = await this.supabase.admin.auth.admin.createUser({
        email: tempEmail,
        password: tempPassword,
        email_confirm: true,
        user_metadata: { school_id: school.id, role: 'STUDENT', full_name: parsed.data.fullName },
      });
      if (authError) {
        rows.push({ row: i + 1, result: 'error', admissionNo: parsed.data.admissionNo, message: authError.message });
        continue;
      }

      const studentAuthId = authData.user.id;
      const newUserId = randomUUID();
      const now = new Date().toISOString();

      await this.supabase.admin.from('users').upsert({
        id: newUserId,
        school_id: school.id,
        auth_id: studentAuthId,
        email: tempEmail,
        full_name: parsed.data.fullName,
        role: 'STUDENT',
        updated_at: now,
      }, { onConflict: 'auth_id' });

      const { data: actualUserRow } = await this.supabase.admin
        .from('users').select('id').eq('auth_id', studentAuthId).single();
      const actualUserId = actualUserRow?.id ?? newUserId;

      const studentId = randomUUID();
      const { error: studentErr } = await this.supabase.admin.from('students').insert({
        id: studentId,
        school_id: school.id,
        user_id: actualUserId,
        admission_no: parsed.data.admissionNo,
        date_of_birth: parsed.data.dateOfBirth ?? null,
        gender: parsed.data.gender ?? null,
        current_class_id: classRow.id,
        updated_at: now,
      });

      if (studentErr) {
        rows.push({ row: i + 1, result: 'error', admissionNo: parsed.data.admissionNo, message: studentErr.message });
      } else {
        rows.push({ row: i + 1, result: 'ok', admissionNo: parsed.data.admissionNo, tempEmail, tempPassword });
      }
    }

    await client.from('audit_logs').insert({
      id: randomUUID(),
      school_id: school.id,
      user_id: callerRow?.id ?? null,
      action: 'students.import_csv',
      entity_type: 'student',
      entity_id: school.id,
      metadata: { total: lines.length - 1, ok: rows.filter(r => r.result === 'ok').length },
    });

    return {
      imported: rows.filter(r => r.result === 'ok').length,
      failed: rows.filter(r => r.result === 'error').length,
      rows,
    };
  }

  private async requireAdmin(accessToken: string) {
    const role = await this.supabase.getUserRole(accessToken);
    if (role !== 'ADMIN') throw new ForbiddenException('Admin role required');
  }

  async promote(accessToken: string, authUserId: string, input: PromoteStudentsInput) {
    const client = this.supabase.forUser(accessToken);
    await this.requireAdmin(accessToken);

    const now = new Date().toISOString();

    if (input.toClassId) {
      const { data, error } = await client
        .from('students')
        .update({ current_class_id: input.toClassId, updated_at: now })
        .eq('current_class_id', input.fromClassId)
        .eq('is_active', true)
        .select('id');
      if (error) throw new BadRequestException(error.message);
      return { promoted: data?.length ?? 0, action: 'promoted' };
    } else {
      const { data, error } = await client
        .from('students')
        .update({ is_active: false, current_class_id: null, updated_at: now })
        .eq('current_class_id', input.fromClassId)
        .eq('is_active', true)
        .select('id');
      if (error) throw new BadRequestException(error.message);
      return { graduated: data?.length ?? 0, action: 'graduated' };
    }
  }

  private async audit(client: ReturnType<SupabaseService['forUser']>, accessToken: string, schoolId: string, action: string, entityType: string, entityId: string, metadata: unknown) {
    const me = await this.supabase.currentUserRow(accessToken, 'id') as { id: string } | null;
    await client.from('audit_logs').insert({ id: randomUUID(), school_id: schoolId, user_id: me?.id ?? null, action, entity_type: entityType, entity_id: entityId, metadata });
  }
}
