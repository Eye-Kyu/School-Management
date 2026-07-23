import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { SupabaseService } from '../supabase/supabase.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { CreateConversationInput, SendMessageInput, BroadcastToClassInput } from '@school-manager/types';
import type { NotifPayload } from '../notifications/notifications.service';

// Basic wordlist — flags messages for admin review without blocking send.
const PROFANITY = ['fuck', 'shit', 'bitch', 'asshole', 'bastard', 'cunt', 'damn', 'piss'];

function hasProfanity(text: string): boolean {
  const lower = text.toLowerCase();
  return PROFANITY.some((w) => new RegExp(`\\b${w}\\b`).test(lower));
}

// 42501 (insufficient_privilege) is what an RLS policy denial raises — that's
// a real 403, not a generic 400. Every DB error in this service should be
// thrown through here rather than left unchecked or wrapped in a plain Error.
function throwDbError(error: { code?: string; message: string }): never {
  if (error.code === '42501') throw new ForbiddenException(error.message);
  throw new BadRequestException(error.message);
}

type ConversationRow = {
  id: string;
  school_id: string;
  parent_user_id: string | null;
  teacher_user_id: string | null;
  admin_user_id: string | null;
};

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
        parent_unread_count, teacher_unread_count, admin_unread_count, created_at, student_id,
        parent:users!parent_user_id(id, full_name, avatar_url),
        teacher:users!teacher_user_id(id, full_name, avatar_url),
        admin:users!admin_user_id(id, full_name, avatar_url),
        student:students(id, user:users!user_id(full_name))
      `)
      .order('last_message_at', { ascending: false, nullsFirst: false });
    if (error) throwDbError(error);
    return data ?? [];
  }

  // Single entry point for starting a thread, regardless of who's initiating.
  // Scope is validated here (fail-fast, API layer) before the write; the
  // conv_insert/msg_insert RLS policies re-check the same rules as defense in
  // depth, since the write itself goes through forUser(), not the admin client.
  async getOrCreateConversation(accessToken: string, input: CreateConversationInput) {
    const userRow = await this.supabase.currentUserRow(accessToken, 'id, role, school_id, full_name') as
      { id: string; role: string; school_id: string; full_name: string } | null;
    if (!userRow) throw new UnauthorizedException();

    let party: { parentUserId: string | null; teacherUserId: string | null; adminUserId: string | null };
    let bypassQuietHours = false;
    let auditAction = 'message.send';

    if (userRow.role === 'PARENT') {
      await this._assertRecipientRole(input.recipientUserId, userRow.school_id, 'TEACHER');
      party = { parentUserId: userRow.id, teacherUserId: input.recipientUserId, adminUserId: null };
    } else if (userRow.role === 'ADMIN') {
      if (input.recipientRole !== 'TEACHER' && input.recipientRole !== 'PARENT') {
        throw new BadRequestException('recipientRole is required for admin-initiated conversations');
      }
      await this._assertRecipientRole(input.recipientUserId, userRow.school_id, input.recipientRole);
      party = input.recipientRole === 'TEACHER'
        ? { parentUserId: null, teacherUserId: input.recipientUserId, adminUserId: userRow.id }
        : { parentUserId: input.recipientUserId, teacherUserId: null, adminUserId: userRow.id };
      bypassQuietHours = input.bypassQuietHours ?? false;
      auditAction = 'message.admin_send';
    } else if (userRow.role === 'TEACHER') {
      await this._assertRecipientRole(input.recipientUserId, userRow.school_id, 'PARENT');
      await this._assertTeacherScope(userRow.id, input.recipientUserId);
      party = { parentUserId: input.recipientUserId, teacherUserId: userRow.id, adminUserId: null };
      auditAction = 'message.teacher_send';
    } else {
      throw new ForbiddenException('Role not permitted to start conversations');
    }

    const conv = await this._findOrCreateConversation(accessToken, {
      schoolId: userRow.school_id,
      ...party,
      studentId: input.studentId ?? null,
    });

    await this._insertMessage({
      accessToken,
      conv,
      senderId: userRow.id,
      senderName: userRow.full_name,
      body: input.firstMessage,
      bypassQuietHours,
      auditAction,
    });

    return { id: conv.id };
  }

  // Recipient must exist, belong to the caller's school, and hold the
  // expected role — produces a clean 400 before the RLS-governed write is
  // even attempted, rather than relying solely on the policy denial.
  private async _assertRecipientRole(userId: string, schoolId: string, role: 'TEACHER' | 'PARENT') {
    const { data } = await this.supabase.admin
      .from('users').select('id').eq('id', userId).eq('school_id', schoolId).eq('role', role).maybeSingle();
    if (!data) throw new BadRequestException(`Recipient is not a ${role.toLowerCase()} at your school`);
  }

  // A teacher may only message a parent of a student in a class they teach
  // (subject_assignments row) or are the class teacher of — mirrors the
  // conv_insert RLS policy's TEACHER branch exactly.
  private async _assertTeacherScope(teacherUserId: string, parentUserId: string) {
    const deny = () => { throw new ForbiddenException('Not a parent of a student you teach'); };

    const { data: teacherRow } = await this.supabase.admin
      .from('teachers').select('id, is_class_teacher_of').eq('user_id', teacherUserId).maybeSingle();
    if (!teacherRow) return deny();

    const { data: guardianRows } = await this.supabase.admin
      .from('guardians').select('student_id').eq('user_id', parentUserId);
    const studentIds = (guardianRows ?? []).map((g) => g.student_id).filter(Boolean);
    if (!studentIds.length) return deny();

    const { data: studentRows } = await this.supabase.admin
      .from('students').select('id, current_class_id').in('id', studentIds);
    const classIds = (studentRows ?? []).map((s) => s.current_class_id).filter(Boolean) as string[];
    if (!classIds.length) return deny();

    if (teacherRow.is_class_teacher_of && classIds.includes(teacherRow.is_class_teacher_of)) return;

    const { data: assignments } = await this.supabase.admin
      .from('subject_assignments').select('class_id').eq('teacher_id', teacherRow.id).in('class_id', classIds);
    if (assignments && assignments.length) return;

    return deny();
  }

  // Find-or-create is done as select-then-insert rather than a Postgres upsert:
  // conversations_unique_idx is an expression index (COALESCE(...)), and
  // PostgREST's on_conflict parameter only accepts a plain column list, not an
  // expression — passing the expression string there fails with "column
  // \"COALESCE\" does not exist" (confirmed against the live DB), which is what
  // previously surfaced as an unhandled 500. A concurrent duplicate insert still
  // hits the real unique index at the DB level; that race is handled below.
  // Runs through forUser() (not the admin client) so conv_insert RLS is real.
  private async _findOrCreateConversation(accessToken: string, params: {
    schoolId: string;
    parentUserId: string | null;
    teacherUserId: string | null;
    adminUserId: string | null;
    studentId: string | null;
  }): Promise<ConversationRow> {
    const client = this.supabase.forUser(accessToken);
    const { schoolId, parentUserId, teacherUserId, adminUserId, studentId } = params;

    const findExisting = async () => {
      let query = client
        .from('conversations')
        .select('id, school_id, parent_user_id, teacher_user_id, admin_user_id')
        .eq('school_id', schoolId);
      query = parentUserId ? query.eq('parent_user_id', parentUserId) : query.is('parent_user_id', null);
      query = teacherUserId ? query.eq('teacher_user_id', teacherUserId) : query.is('teacher_user_id', null);
      query = adminUserId ? query.eq('admin_user_id', adminUserId) : query.is('admin_user_id', null);
      query = studentId ? query.eq('student_id', studentId) : query.is('student_id', null);
      const { data, error } = await query.maybeSingle();
      if (error) throwDbError(error);
      return data;
    };

    const existing = await findExisting();
    if (existing) return existing;

    const { data: created, error: insertErr } = await client
      .from('conversations')
      .insert({
        id: randomUUID(),
        school_id: schoolId,
        parent_user_id: parentUserId,
        teacher_user_id: teacherUserId,
        admin_user_id: adminUserId,
        student_id: studentId,
      })
      .select('id, school_id, parent_user_id, teacher_user_id, admin_user_id')
      .single();

    if (insertErr) {
      if (insertErr.code === '23505') {
        // Lost the race to a concurrent request — the row now exists.
        const raced = await findExisting();
        if (raced) return raced;
      }
      throwDbError(insertErr);
    }
    return created;
  }

  // Class Teacher only — one one-to-one conversation per parent in the class,
  // never a group thread. Unlike getOrCreateConversation looped per-parent,
  // this validates the caller's class-teacher status once (not once per
  // parent) and batches into a single notifications.queue() call and a
  // single audit_logs row for the whole broadcast.
  async broadcastToClass(accessToken: string, input: BroadcastToClassInput) {
    const userRow = await this.supabase.currentUserRow(accessToken, 'id, role, school_id, full_name') as
      { id: string; role: string; school_id: string; full_name: string } | null;
    if (!userRow || userRow.role !== 'TEACHER') throw new ForbiddenException('Class teacher role required');

    const { data: teacherRow } = await this.supabase.admin
      .from('teachers').select('id, is_class_teacher_of').eq('user_id', userRow.id).maybeSingle();
    if (!teacherRow || teacherRow.is_class_teacher_of !== input.classId) {
      throw new ForbiddenException('You are not the class teacher of this class');
    }

    // Parents of students strictly in this class — not the broader
    // "assigned + class-teacher" union availableContacts uses for 1:1 compose.
    const { data: students } = await this.supabase.admin
      .from('students').select('id').eq('current_class_id', input.classId).eq('is_active', true);
    const studentIds = (students ?? []).map((s) => s.id);
    if (!studentIds.length) return { sent: 0, conversationIds: [] };

    const { data: guardians } = await this.supabase.admin
      .from('guardians').select('user_id').in('student_id', studentIds);
    const parentUserIds = [...new Set((guardians ?? []).map((g) => g.user_id).filter(Boolean))];
    if (!parentUserIds.length) return { sent: 0, conversationIds: [] };

    const conversationIds: string[] = [];
    const notifPayloads: NotifPayload[] = [];

    for (const parentUserId of parentUserIds) {
      const conv = await this._findOrCreateConversation(accessToken, {
        schoolId: userRow.school_id,
        parentUserId,
        teacherUserId: userRow.id,
        adminUserId: null,
        studentId: null,
      });
      conversationIds.push(conv.id);
      const notif = await this._insertBroadcastMessage(accessToken, conv, userRow.id, userRow.full_name, input.body);
      if (notif) notifPayloads.push(notif);
    }

    if (notifPayloads.length) await this.notifications.queue(notifPayloads);

    await this.supabase.admin.from('audit_logs').insert({
      id: randomUUID(),
      school_id: userRow.school_id,
      user_id: userRow.id,
      action: 'class_teacher.broadcast_send',
      entity_type: 'class',
      entity_id: input.classId,
      metadata: { recipientCount: parentUserIds.length, conversationIds },
    });

    return { sent: parentUserIds.length, conversationIds };
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
    if (error) throwDbError(error);
    return data ?? [];
  }

  async sendMessage(accessToken: string, conversationId: string, input: SendMessageInput) {
    const userRow = await this.supabase.currentUserRow(accessToken, 'id, role, full_name') as
      { id: string; role: string; full_name: string } | null;
    if (!userRow) throw new UnauthorizedException();

    // Fetch conversation via admin to verify participant
    const { data: conv } = await this.supabase.admin
      .from('conversations')
      .select('id, school_id, parent_user_id, teacher_user_id, admin_user_id')
      .eq('id', conversationId)
      .maybeSingle();
    if (!conv) throw new NotFoundException('Conversation not found');

    const isParticipant = conv.parent_user_id === userRow.id
      || conv.teacher_user_id === userRow.id
      || conv.admin_user_id === userRow.id;
    if (!isParticipant) throw new ForbiddenException('Not a participant');

    await this._insertMessage({
      accessToken,
      conv,
      senderId: userRow.id,
      senderName: userRow.full_name,
      body: input.body,
      bypassQuietHours: false,
      auditAction: 'message.send',
    });

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
      .select('id, parent_user_id, teacher_user_id, admin_user_id')
      .eq('id', conversationId)
      .maybeSingle();
    if (!conv) throw new NotFoundException();

    const isParent = conv.parent_user_id === userRow.id;
    const isTeacher = conv.teacher_user_id === userRow.id;
    const isAdmin = conv.admin_user_id === userRow.id;

    // Mark unread messages as read (msg_update RLS: participant or admin, same school)
    await client
      .from('messages')
      .update({ read_at: new Date().toISOString() })
      .eq('conversation_id', conversationId)
      .neq('sender_id', userRow.id)
      .is('read_at', null);

    // Reset this user's unread counter on the conversation (conv_update RLS)
    if (isParent || isTeacher || isAdmin) {
      const counterField = isParent
        ? 'parent_unread_count'
        : isTeacher
          ? 'teacher_unread_count'
          : 'admin_unread_count';
      await client
        .from('conversations')
        .update({ [counterField]: 0 })
        .eq('id', conversationId);
    }
  }

  async unreadCount(accessToken: string): Promise<number> {
    const client = this.supabase.forUser(accessToken);
    const userRow = await this.supabase.currentUserRow(accessToken, 'id, role') as { id: string; role: string } | null;
    if (!userRow) return 0;

    const { data: convs } = await client
      .from('conversations')
      .select('parent_user_id, teacher_user_id, parent_unread_count, teacher_unread_count, admin_unread_count');

    return (convs ?? []).reduce((sum, c) => {
      const mine = c.parent_user_id === userRow.id
        ? c.parent_unread_count
        : c.teacher_user_id === userRow.id
          ? c.teacher_unread_count
          : c.admin_unread_count;
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
        .from('teachers').select('id, is_class_teacher_of').eq('user_id', userRow.id).maybeSingle();
      if (!teacherRow) return { role: 'TEACHER', contacts: [] };

      // Classes this teacher is assigned to (subject_assignments) or is the
      // class teacher of — either is enough to be in scope for messaging.
      const { data: assignments } = await this.supabase.admin
        .from('subject_assignments').select('class_id').eq('teacher_id', teacherRow.id);
      const classIds = [
        ...new Set([
          ...(assignments ?? []).map((a) => a.class_id).filter(Boolean),
          ...(teacherRow.is_class_teacher_of ? [teacherRow.is_class_teacher_of] : []),
        ]),
      ];
      if (!classIds.length) return { role: 'TEACHER', contacts: [] };

      // Students in those classes
      const { data: students } = await this.supabase.admin
        .from('students').select('id, user:users!user_id(full_name)').in('current_class_id', classIds).eq('is_active', true);
      const studentIds = (students ?? []).map((s) => s.id);
      if (!studentIds.length) return { role: 'TEACHER', contacts: [] };

      // Guardian -> student links for those students, so each contact can be
      // shown grouped by which of the teacher's students they guard.
      const { data: guardians } = await this.supabase.admin
        .from('guardians').select('user_id, student_id').in('student_id', studentIds);
      const guardianUserIds = [...new Set((guardians ?? []).map((g) => g.user_id).filter(Boolean))];
      if (!guardianUserIds.length) return { role: 'TEACHER', contacts: [] };

      const { data: guardianUsers } = await this.supabase.admin
        .from('users').select('id, full_name, avatar_url').in('id', guardianUserIds);

      const studentNameById = new Map(
        (students ?? []).map((s) => [s.id, (s.user as unknown as { full_name: string } | null)?.full_name ?? '']),
      );

      const contacts = (guardianUsers ?? []).map((u) => {
        const studentIdsForGuardian = (guardians ?? [])
          .filter((g) => g.user_id === u.id)
          .map((g) => g.student_id);
        return {
          user_id: u.id,
          user: { id: u.id, full_name: u.full_name as string, avatar_url: u.avatar_url as string | null },
          studentIds: studentIdsForGuardian,
          studentNames: studentIdsForGuardian.map((id) => studentNameById.get(id)).filter(Boolean),
        };
      });

      return { role: 'TEACHER', contacts, students: students ?? [] };
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

    if (userRow.role === 'ADMIN') {
      const { data: teacherUsers } = await this.supabase.admin
        .from('users').select('id, full_name, avatar_url')
        .eq('school_id', userRow.school_id).eq('role', 'TEACHER');

      const { data: parentUsers } = await this.supabase.admin
        .from('users').select('id, full_name, avatar_url')
        .eq('school_id', userRow.school_id).eq('role', 'PARENT');

      const toContact = (u: { id: string; full_name: string; avatar_url: string | null }) => ({
        user_id: u.id,
        user: { id: u.id, full_name: u.full_name, avatar_url: u.avatar_url },
      });

      return {
        role: 'ADMIN',
        teachers: (teacherUsers ?? []).map(toContact),
        parents: (parentUsers ?? []).map(toContact),
      };
    }

    return { role: userRow.role, contacts: [] };
  }

  // ── Private helpers ──────────────────────────────────────

  // Lean sibling of _insertMessage for broadcastToClass — the sender is
  // always the class teacher and the recipient is always the parent, so it
  // skips the quiet-hours check (never applies here) and returns the
  // notification payload instead of queuing/auditing it per-call, so the
  // caller can batch both across the whole broadcast.
  private async _insertBroadcastMessage(
    accessToken: string, conv: ConversationRow, senderId: string, senderName: string, body: string,
  ): Promise<NotifPayload | null> {
    const recipientId = conv.parent_user_id;
    if (!recipientId) return null;

    const flagged = hasProfanity(body);
    const now = new Date();

    const { error: msgErr } = await this.supabase.forUser(accessToken).from('messages').insert({
      id: randomUUID(),
      school_id: conv.school_id,
      conversation_id: conv.id,
      sender_id: senderId,
      body,
      is_flagged: flagged,
      bypass_quiet_hours: false,
      created_at: now.toISOString(),
    });
    if (msgErr) throwDbError(msgErr);

    const { data: counters } = await this.supabase.admin
      .from('conversations').select('parent_unread_count').eq('id', conv.id).single();
    await this.supabase.admin.from('conversations').update({
      last_message_body: body.length > 80 ? `${body.slice(0, 77)}…` : body,
      last_message_at: now.toISOString(),
      parent_unread_count: (counters?.parent_unread_count ?? 0) + 1,
    }).eq('id', conv.id);

    return {
      schoolId: conv.school_id,
      recipientId,
      type: 'NEW_MESSAGE',
      title: `New message from ${senderName}`,
      body: body.length > 100 ? `${body.slice(0, 97)}…` : body,
      metadata: { conversationId: conv.id, senderId },
    };
  }

  private async _insertMessage(params: {
    accessToken: string;
    conv: ConversationRow;
    senderId: string;
    senderName: string;
    body: string;
    bypassQuietHours: boolean;
    auditAction: string;
  }) {
    const { accessToken, conv, senderId, senderName, body, bypassQuietHours, auditAction } = params;
    const { id: conversationId, school_id: schoolId } = conv;

    const recipientId = [conv.parent_user_id, conv.teacher_user_id, conv.admin_user_id]
      .find((id): id is string => Boolean(id) && id !== senderId);
    if (!recipientId) throw new BadRequestException('Conversation has no other participant');

    const flagged = hasProfanity(body);
    const now = new Date();

    // Security-sensitive write: goes through forUser() so msg_insert RLS
    // (sender role, bypass_quiet_hours-only-for-admin, participant check) is real.
    const { error: msgErr } = await this.supabase.forUser(accessToken).from('messages').insert({
      id: randomUUID(),
      school_id: schoolId,
      conversation_id: conversationId,
      sender_id: senderId,
      body,
      is_flagged: flagged,
      bypass_quiet_hours: bypassQuietHours,
      created_at: now.toISOString(),
    });
    if (msgErr) throwDbError(msgErr);

    // Everything below is internal bookkeeping that only runs after the
    // security-checked insert above already succeeded — admin client is fine.
    const { data: counters } = await this.supabase.admin
      .from('conversations')
      .select('parent_unread_count, teacher_unread_count, admin_unread_count')
      .eq('id', conversationId)
      .single();

    const isRecipientParent = recipientId === conv.parent_user_id;
    const isRecipientTeacher = recipientId === conv.teacher_user_id;
    const isRecipientAdmin = recipientId === conv.admin_user_id;

    await this.supabase.admin.from('conversations').update({
      last_message_body: body.length > 80 ? `${body.slice(0, 77)}…` : body,
      last_message_at: now.toISOString(),
      parent_unread_count: isRecipientParent
        ? (counters?.parent_unread_count ?? 0) + 1
        : (counters?.parent_unread_count ?? 0),
      teacher_unread_count: isRecipientTeacher
        ? (counters?.teacher_unread_count ?? 0) + 1
        : (counters?.teacher_unread_count ?? 0),
      admin_unread_count: isRecipientAdmin
        ? (counters?.admin_unread_count ?? 0) + 1
        : (counters?.admin_unread_count ?? 0),
    }).eq('id', conversationId);

    // Quiet hours only apply when the recipient is a teacher (the only role
    // with quiet-hours columns), and only when not explicitly bypassed
    // (bypass is only ever true for admin-sent messages — enforced above and
    // by RLS, not just here).
    let deliverAfter: string | undefined;
    if (!bypassQuietHours) {
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
      action: auditAction,
      entity_type: 'message',
      entity_id: conversationId,
      metadata: { flagged, recipientId, bypassQuietHours },
    });
  }
}
