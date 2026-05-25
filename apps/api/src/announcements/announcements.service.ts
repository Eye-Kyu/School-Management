import { Injectable, ForbiddenException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { SupabaseService } from '../supabase/supabase.service';
import type { CreateAnnouncementInput } from '@school-manager/types';

@Injectable()
export class AnnouncementsService {
  constructor(private readonly supabase: SupabaseService) {}

  async list(accessToken: string) {
    const client = this.supabase.forUser(accessToken);
    const { data, error } = await client
      .from('announcements')
      .select('id, title, body, audience, target_grade_level, target_class_id, published_at, author:users(full_name)')
      .order('published_at', { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async create(accessToken: string, authUserId: string, input: CreateAnnouncementInput) {
    const client = this.supabase.forUser(accessToken);
    await this.requireAdmin(client);

    const { data: school } = await client.from('schools').select('id').single();
    if (!school) throw new ForbiddenException('No school found');

    const { data: authorRow } = await client
      .from('users')
      .select('id, full_name')
      .eq('auth_id', authUserId)
      .maybeSingle();

    if (!authorRow) throw new ForbiddenException('User record not found');

    const id = randomUUID();
    const now = new Date().toISOString();
    const { data, error } = await client
      .from('announcements')
      .insert({
        id,
        school_id: school.id,
        author_id: authorRow.id,
        title: input.title,
        body: input.body,
        audience: input.audience,
        target_grade_level: input.targetGradeLevel ?? null,
        target_class_id: input.targetClassId ?? null,
        published_at: now,
        updated_at: now,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);

    // Return the announcement enriched with author info so the frontend can display it immediately.
    const result = { ...data, author: { full_name: (authorRow as { id: string; full_name: string }).full_name } };

    await client.from('audit_logs').insert({
      id: randomUUID(),
      school_id: school.id,
      user_id: authorRow.id,
      action: 'announcement.create',
      entity_type: 'announcement',
      entity_id: id,
      metadata: { title: input.title, audience: input.audience },
    });

    return result;
  }

  async remove(accessToken: string, announcementId: string) {
    const client = this.supabase.forUser(accessToken);
    await this.requireAdmin(client);

    const { error } = await client
      .from('announcements')
      .delete()
      .eq('id', announcementId);
    if (error) throw new Error(error.message);
    return { deleted: true };
  }

  private async requireAdmin(client: ReturnType<SupabaseService['forUser']>) {
    const { data } = await client.from('users').select('role').maybeSingle();
    if (data?.role !== 'ADMIN') throw new ForbiddenException('Admin role required');
  }
}
