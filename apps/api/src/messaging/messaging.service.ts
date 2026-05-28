import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { SupabaseService } from '../supabase/supabase.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { CreateConversationInput, SendMessageInput } from '@school-manager/types';

// Basic wordlist — flags messages for admin review without blocking send.
const PROFANITY = ['fuck', 'shit', 'bitch', 'asshole', 'bastard', 'cunt', 'damn', 'piss'];

function hasProfanity(text: string): boolean {
  const lower = text.toLowerCase();
  return PROFANITY.some((w) => new RegExp(`\\b${w}\\b`).test(lower));
}

@Injectable()
export class MessagingService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly notifications: NotificationsService,
  ) {}

  // ── Conversations ────────────────────────────────────────

  async listConversations(accessToken: string) {
    const client = this.supabase.forUser(accessToken);
    const { data, error } = await client
      .from('conversations')
      .select(`
        id, last_message_body, last_message_at, is_flagged,
        parent_unread_count, teacher_unread_count, created_at, student_id,
        parent:users!parent_user_id(id, full_name, avatar_url),
        teacher:users!teacher_user_id(id, full_name, avatar_url),
        student:students(id, user:users!user_id(full_name))
      `)
      .order('last_message_at', { ascending: false, nullsFirst: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async getOrCreateConversation(accessToken: string, input: CreateConversationInput) {
    const client = this.supabase.forUser(accessToken);

    const { data: userRow } = await client
      .from('users')
      .select('id, role, school_id, full_name')
      .maybeSingle();
    if (!userRow || userRow.role !== 'PARENT') throw new ForbiddenException('Parent role required');

    // Upsert conversation (idempotent — same parent+teacher+student = one thread)
    const convId = randomUUID();
    const { data: conv, error: convErr } = await this.supabase.admin
      .from('conversations')
      .upsert(
        {
          id: convId,
          school_id: userRow.school_id,
          parent_user_id: userRow.id,
          teacher_user_id: input.teacherUserId,
          student_id: input.studentId ?? null,
        },
        { onConflict: 'school_id,parent_user_id,teacher_user_id,COALESCE(student_id::text, \'\')' },
      )
      .select('id, school_id, parent_user_id, teacher_user_id')
      .single();
    if (convErr) throw new Error(convErr.message);

    // Send first message
    await this._insertMessage(conv.id, conv.school_id, userRow.id, input.firstMessage, conv.teacher_user_id, userRow.full_name, true);

    return { id: conv.id };
  }

  // ── Messages ─────────────────────────────────────────────

  async listMessages(accessToken: string, conversationId: string) {
    const client = this.supabase.forUser(accessToken);
    const { data, error } = await client
      .from('messages')
      .select('id, sender_id, body, is_flagged, read_at, created_at')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
      .limit(200);
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async sendMessage(accessToken: string, conversationId: string, input: SendMessageInput) {
    const client = this.supabase.forUser(accessToken);

    const { data: userRow } = await client
      .from('users')
      .select('id, role, full_name')
      .maybeSingle();
    if (!userRow) throw new UnauthorizedException();

    // Fetch conversation via admin to verify participant
    const { data: conv } = await this.supabase.admin
      .from('conversations')
      .select('id, school_id, parent_user_id, teacher_user_id')
      .eq('id', conversationId)
      .maybeSingle();
    if (!conv) throw new NotFoundException('Conversation not found');

    if (conv.parent_user_id !== userRow.id && conv.teacher_user_id !== userRow.id) {
      throw new ForbiddenException('Not a participant');
    }

    const recipientId =
      conv.parent_user_id === userRow.id ? conv.teacher_user_id : conv.parent_user_id;
    const senderIsParent = conv.parent_user_id === userRow.id;

    await this._insertMessage(
      conv.id, conv.school_id, userRow.id, input.body, recipientId, userRow.full_name, senderIsParent,
    );

    return { sent: true };
  }

  async markRead(accessToken: string, conversationId: string) {
    const client = this.supabase.forUser(accessToken);

    const { data: userRow } = await client.from('users').select('id, role').maybeSingle();
    if (!userRow) throw new UnauthorizedException();

    const { data: conv } = await this.supabase.admin
      .from('conversations')
      .select('id, parent_user_id, teacher_user_id')
      .eq('id', conversationId)
      .maybeSingle();
    if (!conv) throw new NotFoundException();

    const isParent = conv.parent_user_id === userRow.id;
    const isTeacher = conv.teacher_user_id === userRow.id;
    if (!isParent && !isTeacher && userRow.role !== 'ADMIN') throw new ForbiddenException();

    // Mark unread messages as read
    await this.supabase.admin
      .from('messages')
      .update({ read_at: new Date().toISOString() })
      .eq('conversation_id', conversationId)
      .neq('sender_id', userRow.id)
      .is('read_at', null);

    // Reset this user's unread counter on the conversation
    if (isParent || isTeacher) {
      await this.supabase.admin
        .from('conversations')
        .update(isParent ? { parent_unread_count: 0 } : { teacher_unread_count: 0 })
        .eq('id', conversationId);
    }
  }

  async unreadCount(accessToken: string): Promise<number> {
    const client = this.supabase.forUser(accessToken);
    const { data: userRow } = await client.from('users').select('id, role').maybeSingle();
    if (!userRow) return 0;

    const { data: convs } = await client
      .from('conversations')
      .select('parent_user_id, parent_unread_count, teacher_unread_count');

    return (convs ?? []).reduce((sum, c) => {
      const mine = c.parent_user_id === userRow.id ? c.parent_unread_count : c.teacher_unread_count;
      return sum + (mine ?? 0);
    }, 0);
  }

  // Teacher's list of parents available to message (own class parents)
  async availableContacts(accessToken: string) {
    const client = this.supabase.forUser(accessToken);
    const { data: userRow } = await client.from('users').select('id, role, school_id').maybeSingle();
    if (!userRow) throw new UnauthorizedException();

    if (userRow.role === 'TEACHER') {
      // Return parents of students in teacher's assigned classes
      const { data: assignments } = await this.supabase.admin
        .from('subject_assignments')
        .select('class_id')
        .eq('school_id', userRow.school_id);
      const classIds = [...new Set((assignments ?? []).map((a) => a.class_id))];

      const { data: students } = classIds.length
        ? await this.supabase.admin.from('students').select('id').in('current_class_id', classIds)
        : { data: [] };
      const studentIds = (students ?? []).map((s) => s.id);

      const { data: guardians } = studentIds.length
        ? await this.supabase.admin
            .from('guardians')
            .select('user:users!user_id(id, full_name, avatar_url), student:students!student_id(id, user:users!user_id(full_name))')
            .in('student_id', studentIds)
        : { data: [] };
      return { role: 'TEACHER', contacts: guardians ?? [] };
    }

    if (userRow.role === 'PARENT') {
      // Return teachers of the parent's children's classes
      const { data: guardians } = await this.supabase.admin
        .from('guardians')
        .select('student:students!student_id(id, current_class_id, user:users!user_id(full_name))')
        .eq('user_id', userRow.id);

      const classIds = [...new Set(
        (guardians ?? [])
          .map((g) => (g.student as { current_class_id: string })?.current_class_id)
          .filter(Boolean),
      )];

      const { data: assignments } = classIds.length
        ? await this.supabase.admin
            .from('subject_assignments')
            .select('teacher:teachers!teacher_id(user_id, user:users!user_id(id, full_name, avatar_url))')
            .in('class_id', classIds)
        : { data: [] };

      // Deduplicate by teacher user_id
      const seen = new Set<string>();
      const teachers = (assignments ?? [])
        .map((a) => a.teacher as { user_id: string; user: { id: string; full_name: string; avatar_url?: string } })
        .filter((t) => t?.user_id && !seen.has(t.user_id) && seen.add(t.user_id));

      const students = (guardians ?? []).map((g) => g.student);
      return { role: 'PARENT', contacts: teachers, students };
    }

    return { role: userRow.role, contacts: [] };
  }

  // ── Private helpers ──────────────────────────────────────

  private async _insertMessage(
    conversationId: string,
    schoolId: string,
    senderId: string,
    body: string,
    recipientId: string,
    senderName: string,
    senderIsParent: boolean,
  ) {
    const flagged = hasProfanity(body);
    const now = new Date();

    // Insert message
    await this.supabase.admin.from('messages').insert({
      id: randomUUID(),
      school_id: schoolId,
      conversation_id: conversationId,
      sender_id: senderId,
      body,
      is_flagged: flagged,
      created_at: now.toISOString(),
    });

    // Update conversation counters
    const { data: conv } = await this.supabase.admin
      .from('conversations')
      .select('parent_unread_count, teacher_unread_count')
      .eq('id', conversationId)
      .single();

    await this.supabase.admin.from('conversations').update({
      last_message_body: body.length > 80 ? `${body.slice(0, 77)}…` : body,
      last_message_at: now.toISOString(),
      teacher_unread_count: senderIsParent
        ? (conv?.teacher_unread_count ?? 0) + 1
        : (conv?.teacher_unread_count ?? 0),
      parent_unread_count: !senderIsParent
        ? (conv?.parent_unread_count ?? 0) + 1
        : (conv?.parent_unread_count ?? 0),
    }).eq('id', conversationId);

    // Quiet hours check (only when parent messages teacher)
    let deliverAfter: string | undefined;
    if (senderIsParent) {
      const { data: teacherRow } = await this.supabase.admin
        .from('teachers')
        .select('quiet_hours_start, quiet_hours_end')
        .eq('user_id', recipientId)
        .maybeSingle();

      if (teacherRow) {
        const nairobiHour = (now.getUTCHours() + 3) % 24;
        const { quiet_hours_start: qs, quiet_hours_end: qe } = teacherRow;
        const inQuiet = qs > qe
          ? nairobiHour >= qs || nairobiHour < qe
          : nairobiHour >= qs && nairobiHour < qe;

        if (inQuiet) {
          const hoursUntil = ((qe - nairobiHour) + 24) % 24 || 24;
          const wakeup = new Date(now.getTime() + hoursUntil * 3_600_000);
          wakeup.setUTCMinutes(0, 0, 0);
          deliverAfter = wakeup.toISOString();
        }
      }
    }

    await this.notifications.queue([{
      schoolId,
      recipientId,
      type: 'NEW_MESSAGE',
      title: `New message from ${senderName}`,
      body: body.length > 100 ? `${body.slice(0, 97)}…` : body,
      metadata: { conversationId, senderId },
      deliverAfter,
    }]);

    // Audit log
    await this.supabase.admin.from('audit_logs').insert({
      id: randomUUID(),
      school_id: schoolId,
      user_id: senderId,
      action: 'message.send',
      entity_type: 'message',
      entity_id: conversationId,
      metadata: { flagged, recipientId },
    });
  }
}
