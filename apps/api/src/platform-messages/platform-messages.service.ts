import { BadRequestException, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { SupabaseService } from '../supabase/supabase.service';
import type { SendPlatformMessageInput } from '@school-manager/types';

@Injectable()
export class PlatformMessagesService {
  constructor(private readonly supabase: SupabaseService) {}

  // ASSIST-MODE-style cross-tenant fan-out: resolving "every ADMIN across N
  // schools" is impossible under forUser/RLS for a SUPER_ADMIN (users RLS has
  // no cross-school SELECT branch, same reasoning as PlatformPrivilegedAccessService).
  // supabase.admin is the legitimate, established pattern for this.
  async send(accessToken: string, input: SendPlatformMessageInput) {
    const me = (await this.supabase.currentUserRow(accessToken, 'id')) as { id: string } | null;
    if (!me) throw new BadRequestException('Sender not found');

    let schoolIds: string[];
    if (input.audience.type === 'ALL') {
      const { data } = await this.supabase.admin.from('schools').select('id');
      schoolIds = (data ?? []).map((s) => s.id as string);
    } else if (input.audience.type === 'PACKAGE') {
      const { data } = await this.supabase.admin
        .from('school_subscriptions')
        .select('school_id')
        .eq('package_id', input.audience.packageId)
        .eq('status', 'ACTIVE');
      schoolIds = Array.from(new Set((data ?? []).map((s) => s.school_id as string)));
    } else {
      schoolIds = input.audience.schoolIds;
    }
    if (schoolIds.length === 0) throw new BadRequestException('No schools match the selected audience');

    const { data: admins, error: adminsErr } = await this.supabase.admin
      .from('users')
      .select('id, school_id')
      .in('school_id', schoolIds)
      .eq('role', 'ADMIN')
      .eq('is_active', true)
      .is('deleted_at', null);
    if (adminsErr) throw new Error(adminsErr.message);
    if (!admins || admins.length === 0) throw new BadRequestException('No school admins found for the selected audience');

    const messageId = randomUUID();
    const { error: msgErr } = await this.supabase.admin.from('platform_messages').insert({
      id: messageId,
      sender_user_id: me.id,
      subject: input.subject,
      body: input.body,
    });
    if (msgErr) throw new Error(msgErr.message);

    const recipientRows = admins.map((a) => ({
      id: randomUUID(),
      platform_message_id: messageId,
      recipient_school_id: a.school_id as string,
      recipient_user_id: a.id as string,
    }));
    const { error: recErr } = await this.supabase.admin.from('platform_message_recipients').insert(recipientRows);
    if (recErr) throw new Error(recErr.message);

    await this.supabase.admin.from('audit_logs').insert({
      id: randomUUID(),
      school_id: null,
      user_id: me.id,
      action: 'platform_message.send',
      entity_type: 'platform_message',
      entity_id: messageId,
      metadata: { message_id: messageId, recipient_count: recipientRows.length, audience_criteria: input.audience },
    });

    return { id: messageId, recipientCount: recipientRows.length };
  }

  async listSent(accessToken: string) {
    const client = this.supabase.forUser(accessToken);
    const { data: messages, error } = await client
      .from('platform_messages')
      .select('id, subject, body, sent_at')
      .order('sent_at', { ascending: false });
    if (error) throw new Error(error.message);
    if (!messages || messages.length === 0) return [];

    const messageIds = messages.map((m) => m.id);
    const { data: recipients } = await client
      .from('platform_message_recipients')
      .select('platform_message_id, read_at')
      .in('platform_message_id', messageIds);

    const stats = new Map<string, { total: number; read: number }>();
    for (const r of recipients ?? []) {
      const s = stats.get(r.platform_message_id) ?? { total: 0, read: 0 };
      s.total += 1;
      if (r.read_at) s.read += 1;
      stats.set(r.platform_message_id, s);
    }

    return messages.map((m) => ({
      ...m,
      recipientCount: stats.get(m.id)?.total ?? 0,
      readCount: stats.get(m.id)?.read ?? 0,
    }));
  }
}
