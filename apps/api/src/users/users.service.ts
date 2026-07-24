import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { SupabaseService } from '../supabase/supabase.service';
import type { UpdateProfileInput } from '@school-manager/types';

@Injectable()
export class UsersService {
  constructor(private readonly supabase: SupabaseService) {}

  async updateMe(accessToken: string, authUserId: string, input: UpdateProfileInput) {
    const client = this.supabase.forUser(accessToken);

    const patch: Record<string, unknown> = {
      full_name: input.fullName,
      phone: input.phone ?? null,
      ...(input.avatarUrl !== undefined ? { avatar_url: input.avatarUrl } : {}),
    };

    const { data, error } = await client
      .from('users')
      .update(patch)
      .eq('auth_id', authUserId)
      .select('id, school_id, full_name, phone, email, role, avatar_url')
      .single();

    if (error) {
      // PGRST116 = .single() got zero (or >1) rows — for an UPDATE keyed on
      // the caller's own auth_id, zero rows means RLS didn't recognize this
      // as their own row (should be unreachable now that users_update_self
      // exists, but this is the defensive backstop the spec asks for rather
      // than ever surfacing the raw PostgREST error to the user).
      if (error.code === 'PGRST116') {
        throw new ForbiddenException("You don't have permission to update this profile.");
      }
      throw new BadRequestException(error.message);
    }

    await this.audit(client, data.school_id, data.id, {
      changedFields: Object.keys(patch),
    });

    return data;
  }

  private async audit(
    client: ReturnType<SupabaseService['forUser']>,
    schoolId: string | null,
    userId: string,
    metadata: unknown,
  ) {
    await client.from('audit_logs').insert({
      id: randomUUID(),
      school_id: schoolId,
      user_id: userId,
      action: 'user.profile_update',
      entity_type: 'user',
      entity_id: userId,
      metadata,
    });
  }

  async getNotifPrefs(accessToken: string) {
    const { data } = await this.supabase
      .forUser(accessToken)
      .from('notification_preferences')
      .select('notification_type, email_enabled');
    return data ?? [];
  }

  async updateNotifPrefs(
    accessToken: string,
    prefs: { type: string; emailEnabled: boolean }[],
  ) {
    // Use getUserRole pattern to safely get user row without multi-row RLS collision
    const role = await this.supabase.getUserRole(accessToken);
    if (!role) throw new BadRequestException('User not found');

    const parts = accessToken.split('.');
    const payload = JSON.parse(Buffer.from(parts[1]!, 'base64').toString()) as { sub?: string };
    const authUserId = payload.sub ?? '';

    const { data: userRow } = await this.supabase.admin
      .from('users')
      .select('id, school_id')
      .eq('auth_id', authUserId)
      .maybeSingle();
    if (!userRow) throw new BadRequestException('User not found');

    const client = this.supabase.forUser(accessToken);

    for (const p of prefs) {
      await client.from('notification_preferences').upsert(
        {
          id: randomUUID(),
          school_id: userRow.school_id,
          user_id: userRow.id,
          notification_type: p.type,
          email_enabled: p.emailEnabled,
        },
        { onConflict: 'user_id,notification_type' },
      );
    }
    return { updated: prefs.length };
  }
}
