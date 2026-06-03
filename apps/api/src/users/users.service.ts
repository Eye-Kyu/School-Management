import { Injectable, BadRequestException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { SupabaseService } from '../supabase/supabase.service';
import type { UpdateProfileInput } from '@school-manager/types';

@Injectable()
export class UsersService {
  constructor(private readonly supabase: SupabaseService) {}

  async updateMe(accessToken: string, authUserId: string, input: UpdateProfileInput) {
    const client = this.supabase.forUser(accessToken);

    const { data, error } = await client
      .from('users')
      .update({
        full_name: input.fullName,
        phone: input.phone ?? null,
        ...(input.avatarUrl !== undefined ? { avatar_url: input.avatarUrl } : {}),
      })
      .eq('auth_id', authUserId)
      .select('full_name, phone, email, role, avatar_url')
      .single();

    if (error) throw new BadRequestException(error.message);
    return data;
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
