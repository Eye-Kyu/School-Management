import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { SupabaseService } from '../supabase/supabase.service';
import type { CreateSuperAdminInput, UpdateSuperAdminPermissionsInput, UpdateUserStatusInput } from '@school-manager/types';

const DEFAULT_PAGE_SIZE = 50;
const MIN_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 200;

export type SearchUsersQuery = {
  q?: string;
  role?: string;
  schoolId?: string;
  page?: number;
  pageSize?: number;
};

@Injectable()
export class PlatformUsersService {
  constructor(private readonly supabase: SupabaseService) {}

  private async resolveCaller(callerAuthId: string) {
    const { data } = await this.supabase.admin.from('users').select('id').eq('auth_id', callerAuthId).maybeSingle();
    return data;
  }

  /** Cross-tenant search across all tenant users, for support/operations. */
  async search(query: SearchUsersQuery) {
    const page = Math.max(1, Math.floor(query.page ?? 1) || 1);
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(MIN_PAGE_SIZE, Math.floor(query.pageSize ?? DEFAULT_PAGE_SIZE) || DEFAULT_PAGE_SIZE));

    let builder = this.supabase.admin
      .from('users')
      .select('id, full_name, email, phone, role, is_active, school_id, created_at, school:schools(id, name)', { count: 'exact' })
      .order('created_at', { ascending: false });

    if (query.role) builder = builder.eq('role', query.role);
    if (query.schoolId) builder = builder.eq('school_id', query.schoolId);
    if (query.q) {
      const escaped = query.q.replace(/"/g, '\\"');
      const like = `%${escaped}%`;
      builder = builder.or(`full_name.ilike."${like}",email.ilike."${like}",phone.ilike."${like}"`);
    }

    const start = (page - 1) * pageSize;
    const end = start + pageSize - 1;
    const { data, error, count } = await builder.range(start, end);
    if (error) throw new BadRequestException(error.message);

    return { rows: data ?? [], total: count ?? 0, page, pageSize };
  }

  async updateUserStatus(userId: string, input: UpdateUserStatusInput, callerAuthId: string) {
    const caller = await this.resolveCaller(callerAuthId);
    const { data: existing } = await this.supabase.admin.from('users').select('id, school_id, is_active').eq('id', userId).maybeSingle();
    if (!existing) throw new NotFoundException('User not found');

    const { data, error } = await this.supabase.admin
      .from('users')
      .update({ is_active: input.isActive, updated_at: new Date().toISOString() })
      .eq('id', userId)
      .select('id, full_name, is_active')
      .single();
    if (error) throw new BadRequestException(error.message);

    await this.supabase.admin.from('audit_logs').insert({
      id: randomUUID(),
      school_id: existing.school_id,
      user_id: caller?.id ?? null,
      action: 'platform_user.status_change',
      entity_type: 'users',
      entity_id: userId,
      metadata: { from: existing.is_active, to: input.isActive },
    });

    return data;
  }

  /** Every SUPER_ADMIN account with its platform_permissions — today there is no other way to see this. */
  async listSuperAdmins() {
    const { data, error } = await this.supabase.admin
      .from('users')
      .select('id, full_name, email, phone, platform_permissions, is_active, created_at')
      .eq('role', 'SUPER_ADMIN')
      .order('created_at', { ascending: false });
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  /**
   * Creates a SUPER_ADMIN account. Mirrors onboardSchool()'s admin-creation
   * pattern exactly (supabase.admin.auth.admin.createUser, temp password
   * returned once) but with role: 'SUPER_ADMIN' and no school_id — the
   * handle_new_auth_user() trigger grants all 17 platform permissions
   * automatically for that combination.
   */
  async createSuperAdmin(input: CreateSuperAdminInput, callerAuthId: string) {
    if (!input.email && !input.phone) {
      throw new BadRequestException('Either email or phone is required');
    }
    const caller = await this.resolveCaller(callerAuthId);

    const tempPassword = Math.random().toString(36).slice(-10) + 'Aa1!';
    const { data: authData, error: authError } = await this.supabase.admin.auth.admin.createUser({
      email: input.email,
      phone: input.phone,
      password: tempPassword,
      email_confirm: true,
      user_metadata: { role: 'SUPER_ADMIN', full_name: input.fullName },
    });
    if (authError) throw new BadRequestException(authError.message);

    const { data: userRow } = await this.supabase.admin
      .from('users')
      .select('id, full_name, email, phone, platform_permissions')
      .eq('auth_id', authData.user.id)
      .single();

    await this.supabase.admin.from('audit_logs').insert({
      id: randomUUID(),
      school_id: null,
      user_id: caller?.id ?? null,
      action: 'platform_user.super_admin_create',
      entity_type: 'users',
      entity_id: userRow?.id ?? null,
      metadata: { fullName: input.fullName, email: input.email ?? null },
    });

    return { ...userRow, temporaryPassword: tempPassword };
  }

  async updateSuperAdminPermissions(userId: string, input: UpdateSuperAdminPermissionsInput, callerAuthId: string) {
    const caller = await this.resolveCaller(callerAuthId);
    const { data: existing } = await this.supabase.admin.from('users').select('id, role').eq('id', userId).maybeSingle();
    if (!existing) throw new NotFoundException('User not found');
    if (existing.role !== 'SUPER_ADMIN') throw new BadRequestException('User is not a SUPER_ADMIN');

    const { data, error } = await this.supabase.admin
      .from('users')
      .update({ platform_permissions: input.permissions, updated_at: new Date().toISOString() })
      .eq('id', userId)
      .select('id, full_name, platform_permissions')
      .single();
    if (error) throw new BadRequestException(error.message);

    await this.supabase.admin.from('audit_logs').insert({
      id: randomUUID(),
      school_id: null,
      user_id: caller?.id ?? null,
      action: 'platform_user.permissions_change',
      entity_type: 'users',
      entity_id: userId,
      metadata: { permissions: input.permissions },
    });

    return data;
  }
}
