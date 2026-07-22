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
    const userRow = await this.supabase.currentUserRow(accessToken, 'id, role, school_id, full_name') as
      { id: string; role: string; school_id: string; full_name: string } | null;
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
    const userRow = await this.supabase.currentUserRow(accessToken, 'id, role, full_name') as
      { id: string; role: string; full_name: string } | null;
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

    const userRow = await this.supabase.currentUserRow(accessToken, 'id, role') as { id: string; role: string } | null;
    if (!userRow) throw new UnauthorizedException();

    // RLS-scoped (conv_select): only resolves if the caller is a participant
    // or an admin in the same school as this conversation — no manual
    // cross-tenant check needed, and no way to bypass it via role alone.
    const { data: conv } = await client
      .from('conversations')
      .select('id, parent_user_id, teacher_user_id')
      .eq('id', conversationId)
      .maybeSingle();
    if (!conv) throw new NotFoundException();

    const isParent = conv.parent_user_id === userRow.id;
    const isTeacher = conv.teacher_user_id === userRow.id;

    // Mark unread messages as read (msg_update RLS: participant or admin, same school)
    await client
      .from('messages')
      .update({ read_at: new Date().toISOString() })
      .eq('conversation_id', conversationId)
      .neq('sender_id', userRow.id)
      .is('read_at', null);

    // Reset this user's unread counter on the conversation (conv_update RLS)
    if (isParent || isTeacher) {
      await client
        .from('conversations')
        .update(isParent ? { parent_unread_count: 0 } : { teacher_unread_count: 0 })
        .eq('id', conversationId);
    }
  }

  async unreadCount(accessToken: string): Promise<number> {
    const client = this.supabase.forUser(accessToken);
    const userRow = await this.supabase.currentUserRow(accessToken, 'id, role') as { id: string; role: string } | null;
    if (!userRow) return 0;

    const { data: convs } = await client
      .from('conversations')
      .select('parent_user_id, parent_unread_count, teacher_unread_count');

    return (convs ?? []).reduce((sum, c) => {
      const mine = c.parent_user_id === userRow.id ? c.parent_unread_count : c.teacher_unread_count;
      return sum + (mine ?? 0);
    }, 0);
  }

  // Contacts available to message — flat queries to avoid PostgREST nested-array issues
  async availableContacts(accessToken: string) {
    const userRow = await this.supabase.currentUserRow(accessToken, 'id, role, school_id') as
      { id: string; role: string; school_id: string } | null;
    if (!userRow) throw new UnauthorizedException();

    if (userRow.role === 'TEACHER') {
      // Resolve teachers.id from users.id
      const { data: teacherRow } = await this.supabase.admin
        .from('teachers').select('id').eq('user_id', userRow.id).maybeSingle();
      if (!teacherRow) return { role: 'TEACHER', contacts: [] };

      // Classes this teacher is assigned to
      const { data: assignments } = await this.supabase.admin
        .from('subject_assignments').select('class_id').eq('teacher_id', teacherRow.id);
      const classIds = [...new Set((assignments ?? []).map((a) => a.class_id).filter(Boolean))];
      if (!classIds.length) return { role: 'TEACHER', contacts: [] };

      // Students in those classes
      const { data: students } = await this.supabase.admin
        .from('students').select('id').in('current_class_id', classIds).eq('is_active', true);
      const studentIds = (students ?? []).map((s) => s.id);
      if (!studentIds.length) return { role: 'TEACHER', contacts: [] };

      // Guardian user IDs for those students
      const { data: guardians } = await this.supabase.admin
        .from('guardians').select('user_id, student_id').in('student_id', studentIds);
      const guardianUserIds = [...new Set((guardians ?? []).map((g) => g.user_id).filter(Boolean))];
      if (!guardianUserIds.length) return { role: 'TEACHER', contacts: [] };

      // Fetch guardian user info
      const { data: guardianUsers } = await this.supabase.admin
        .from('users').select('id, full_name, avatar_url').in('id', guardianUserIds);

      const contacts = (guardianUsers ?? []).map((u) => ({
        user_id: u.id,
        user: { id: u.id, full_name: u.full_name as string, avatar_url: u.avatar_url as string | null },
      }));

      // Also return student list for context
      const { data: studentUsers } = await this.supabase.admin
        .from('students').select('id, user_id, current_class_id, user:users!user_id(full_name)').in('id', studentIds);

      return { role: 'TEACHER', contacts, students: studentUsers ?? [] };
    }

    if (userRow.role === 'PARENT') {
      // Children of this parent
      const { data: guardians } = await this.supabase.admin
        .from('guardians').select('student_id').eq('user_id', userRow.id);
      const studentIds = (guardians ?? []).map((g) => g.student_id).filter(Boolean);
      if (!studentIds.length) return { role: 'PARENT', contacts: [], students: [] };

      const { data: studentRows } = await this.supabase.admin
        .from('students').select('id, current_class_id, user:users!user_id(full_name)').in('id', studentIds);
      const classIds = [...new Set((studentRows ?? []).map((s) => s.current_class_id).filter(Boolean))];

      if (!classIds.length) return { role: 'PARENT', contacts: [], students: studentRows ?? [] };

      // Teachers assigned to those classes
      const { data: saRows } = await this.supabase.admin
        .from('subject_assignments')
        .select('teacher:teachers!teacher_id(user_id)')
        .in('class_id', classIds);

      // subject_assignments.teacher_id is many-to-one to teachers, so
      // PostgREST returns `teacher` as a single object, not an array.
      const teacherUserIds = [
        ...new Set(
          (saRows ?? [])
            .map((a) => (a.teacher as unknown as { user_id: string } | null)?.user_id)
            .filter((id): id is string => Boolean(id)),
        ),
      ];

      const { data: teacherUsers } = teacherUserIds.length
        ? await this.supabase.admin.from('users').select('id, full_name, avatar_url').in('id', teacherUserIds)
        : { data: [] };

      const contacts = (teacherUsers ?? []).map((u) => ({
        user_id: u.id,
        user: { id: u.id, full_name: u.full_name as string, avatar_url: u.avatar_url as string | null },
      }));

      return { role: 'PARENT', contacts, students: studentRows ?? [] };
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
