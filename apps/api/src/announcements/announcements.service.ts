import { Injectable, ForbiddenException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { SupabaseService } from '../supabase/supabase.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { CreateAnnouncementInput } from '@school-manager/types';

@Injectable()
export class AnnouncementsService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly notifications: NotificationsService,
  ) {}

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

    // Queue in-app notifications for the target audience (no email/SMS for announcements)
    this.queueAnnouncementNotifications(
      school.id,
      authorRow.id,
      input.title,
      input.body,
      input.audience,
      input.targetGradeLevel ?? null,
      input.targetClassId ?? null,
    ).catch((err) => console.error('[AnnouncementsService] notification error:', err));

    return result;
  }

  private async queueAnnouncementNotifications(
    schoolId: string,
    authorId: string,
    title: string,
    body: string,
    audience: string,
    targetGradeLevel: number | null,
    targetClassId: string | null,
  ) {
    const recipientIds = await this.resolveAudienceUserIds(
      schoolId,
      authorId,
      audience,
      targetGradeLevel,
      targetClassId,
    );
    if (recipientIds.length === 0) return;

    const bodyPreview = body.length > 200 ? `${body.slice(0, 197)}…` : body;
    const payloads = recipientIds.map((uid) => ({
      schoolId,
      recipientId: uid,
      type: 'NEW_ANNOUNCEMENT' as const,
      title: `New announcement: ${title}`,
      body: bodyPreview,
      metadata: { audience, targetGradeLevel, targetClassId },
      // In-app only — skip email/SMS dispatch
      skipExternalChannels: true,
    }));

    await this.notifications.queue(payloads);
  }

  private async resolveAudienceUserIds(
    schoolId: string,
    authorId: string,
    audience: string,
    targetGradeLevel: number | null,
    targetClassId: string | null,
  ): Promise<string[]> {
    // School-wide: all teachers + all parents (not students or admins)
    if (audience === 'SCHOOL_WIDE') {
      const { data } = await this.supabase.admin
        .from('users')
        .select('id')
        .eq('school_id', schoolId)
        .in('role', ['TEACHER', 'PARENT'])
        .neq('id', authorId);
      return (data ?? []).map((u) => u.id);
    }

    // Teachers only
    if (audience === 'TEACHERS') {
      const { data } = await this.supabase.admin
        .from('users')
        .select('id')
        .eq('school_id', schoolId)
        .eq('role', 'TEACHER')
        .neq('id', authorId);
      return (data ?? []).map((u) => u.id);
    }

    // Parents only
    if (audience === 'PARENTS') {
      const { data } = await this.supabase.admin
        .from('users')
        .select('id')
        .eq('school_id', schoolId)
        .eq('role', 'PARENT')
        .neq('id', authorId);
      return (data ?? []).map((u) => u.id);
    }

    if (audience === 'GRADE' && targetGradeLevel != null) {
      const { data: classRows } = await this.supabase.admin
        .from('classes')
        .select('id')
        .eq('school_id', schoolId)
        .eq('grade_level', targetGradeLevel);
      const classIds = (classRows ?? []).map((c) => c.id);
      return this.guardiansAndTeachersForClasses(schoolId, authorId, classIds);
    }

    if (audience === 'CLASS' && targetClassId) {
      return this.guardiansAndTeachersForClasses(schoolId, authorId, [targetClassId]);
    }

    return [];
  }

  private async guardiansAndTeachersForClasses(
    schoolId: string,
    excludeId: string,
    classIds: string[],
  ): Promise<string[]> {
    if (classIds.length === 0) return [];

    // Parents of students in these classes
    const { data: students } = await this.supabase.admin
      .from('students')
      .select('id')
      .in('current_class_id', classIds)
      .eq('school_id', schoolId);

    const studentIds = (students ?? []).map((s) => s.id);

    const { data: guardians } = studentIds.length > 0
      ? await this.supabase.admin
          .from('guardians')
          .select('user_id')
          .in('student_id', studentIds)
      : { data: [] };

    const guardianUserIds = (guardians ?? []).map((g) => g.user_id);

    // Teachers assigned to these classes
    const { data: assignments } = await this.supabase.admin
      .from('subject_assignments')
      .select('teacher:teachers!inner(user_id)')
      .in('class_id', classIds);

    const teacherUserIds = (assignments ?? [])
      .flatMap((a) => (a.teacher as unknown as { user_id: string }[]) ?? [])
      .map((t) => t.user_id)
      .filter(Boolean);

    return [...new Set([...guardianUserIds, ...teacherUserIds])].filter(
      (uid) => uid && uid !== excludeId,
    );
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
