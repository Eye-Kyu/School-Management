import { Injectable, ForbiddenException, BadRequestException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { SupabaseService } from '../supabase/supabase.service';
import type { CreateParentInput } from '@school-manager/types';

@Injectable()
export class GuardiansService {
  constructor(private readonly supabase: SupabaseService) {}

  async list(accessToken: string) {
    const client = this.supabase.forUser(accessToken);
    const { data, error } = await client
      .from('guardians')
      .select(`
        id, relationship,
        parent:users!inner(id, full_name, email, phone),
        student:students!inner(id, admission_no, user:users!inner(full_name))
      `)
      .order('created_at');
    if (error) throw new Error(error.message);

    // Group guardian rows by parent user so each parent appears once with all children
    const grouped = new Map<string, {
      userId: string;
      fullName: string;
      email: string | null;
      phone: string | null;
      children: { admissionNo: string; studentName: string; relationship: string }[];
    }>();

    for (const row of data ?? []) {
      const parent = row.parent as { id: string; full_name: string; email: string | null; phone: string | null };
      if (!grouped.has(parent.id)) {
        grouped.set(parent.id, {
          userId: parent.id,
          fullName: parent.full_name,
          email: parent.email,
          phone: parent.phone,
          children: [],
        });
      }
      const student = row.student as { admission_no: string; user: { full_name: string } };
      grouped.get(parent.id)!.children.push({
        admissionNo: student.admission_no,
        studentName: student.user.full_name,
        relationship: row.relationship,
      });
    }
    return Array.from(grouped.values());
  }

  async create(accessToken: string, input: CreateParentInput) {
    const client = this.supabase.forUser(accessToken);
    await this.requireAdmin(client);

    const { data: school } = await client.from('schools').select('id').single();
    if (!school) throw new ForbiddenException('No school found');

    if (!input.email && !input.phone) {
      throw new BadRequestException('Parent must have either an email or phone number');
    }

    // 1. Create Supabase auth user
    const tempPassword = Math.random().toString(36).slice(-10) + 'Aa1!';
    const { data: authData, error: authError } = await this.supabase.admin.auth.admin.createUser({
      email: input.email,
      phone: input.phone,
      password: tempPassword,
      email_confirm: true,
      user_metadata: { school_id: school.id, role: 'PARENT', full_name: input.fullName },
    });
    if (authError) throw new BadRequestException(authError.message);

    const authUserId = authData.user.id;

    // 2. Upsert public.users row (trigger may have already created it)
    const userId = randomUUID();
    const { error: userError } = await this.supabase.admin.from('users').upsert({
      id: userId,
      school_id: school.id,
      auth_id: authUserId,
      email: input.email ?? null,
      phone: input.phone ?? null,
      full_name: input.fullName,
      role: 'PARENT',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'auth_id' });
    if (userError) throw new Error(userError.message);

    const { data: userRow } = await this.supabase.admin
      .from('users').select('id').eq('auth_id', authUserId).single();
    const actualUserId = userRow?.id ?? userId;

    // 3. Create a guardian link for each child admission number
    for (const admNo of input.childAdmissionNos) {
      const { data: student } = await this.supabase.admin
        .from('students')
        .select('id')
        .eq('admission_no', admNo)
        .eq('school_id', school.id)
        .maybeSingle();
      if (!student) throw new BadRequestException(`Student with admission number "${admNo}" not found`);

      const { error: gError } = await this.supabase.admin.from('guardians').insert({
        id: randomUUID(),
        user_id: actualUserId,
        student_id: student.id,
        relationship: input.relationship.toLowerCase(),
        is_primary: true,
      });
      if (gError) throw new Error(gError.message);
    }

    await this.audit(client, school.id, 'guardian.create', 'user', actualUserId, {
      fullName: input.fullName,
      childAdmissionNos: input.childAdmissionNos,
    });

    return { userId: actualUserId, temporaryPassword: tempPassword };
  }

  async remove(accessToken: string, parentUserId: string) {
    const client = this.supabase.forUser(accessToken);
    await this.requireAdmin(client);

    const { data: user } = await client
      .from('users')
      .select('id, school_id')
      .eq('id', parentUserId)
      .eq('role', 'PARENT')
      .maybeSingle();
    if (!user) throw new NotFoundException('Parent not found');

    await this.supabase.admin.from('guardians').delete().eq('user_id', parentUserId);
    await this.supabase.admin.from('users').update({
      is_active: false,
      deleted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', parentUserId);

    await this.audit(client, user.school_id, 'guardian.delete', 'user', parentUserId, {});
    return { deleted: true };
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
