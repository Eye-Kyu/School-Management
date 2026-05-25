import { Injectable, ForbiddenException, BadRequestException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { SupabaseService } from '../supabase/supabase.service';
import type { CreateTimetableSlotInput } from '@school-manager/types';

const DAY_MAP: Record<number, string> = {
  0: 'SUNDAY',
  1: 'MONDAY',
  2: 'TUESDAY',
  3: 'WEDNESDAY',
  4: 'THURSDAY',
  5: 'FRIDAY',
  6: 'SATURDAY',
};

@Injectable()
export class TimetableService {
  constructor(private readonly supabase: SupabaseService) {}

  async list(
    accessToken: string,
    filters: { classId?: string; teacherId?: string; day?: string },
  ) {
    const client = this.supabase.forUser(accessToken);
    let q = client
      .from('timetable_slots')
      .select(`
        id, day_of_week, start_time, end_time, room,
        class:classes(id, name, grade_level),
        subject:subjects(id, name, code),
        teacher:teachers!inner(id, user:users!inner(id, full_name))
      `)
      .order('day_of_week')
      .order('start_time');

    if (filters.classId) q = q.eq('class_id', filters.classId);
    if (filters.teacherId) q = q.eq('teacher_id', filters.teacherId);
    if (filters.day) q = q.eq('day_of_week', filters.day.toUpperCase());

    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async today(accessToken: string, authUserId: string) {
    const client = this.supabase.forUser(accessToken);
    const todayDay = DAY_MAP[new Date().getDay()];

    // Resolve the user's role to determine which slots to return.
    const { data: userRow } = await client
      .from('users')
      .select('id, role')
      .eq('auth_id', authUserId)
      .maybeSingle();

    if (!userRow) return [];

    let q = client
      .from('timetable_slots')
      .select(`
        id, day_of_week, start_time, end_time, room,
        class:classes(id, name),
        subject:subjects(id, name, code),
        teacher:teachers!inner(id, user:users!inner(id, full_name))
      `)
      .eq('day_of_week', todayDay)
      .order('start_time');

    if (userRow.role === 'TEACHER') {
      const { data: teacher } = await client
        .from('teachers')
        .select('id')
        .eq('user_id', userRow.id)
        .maybeSingle();
      if (!teacher) return [];
      q = q.eq('teacher_id', teacher.id);
    } else if (userRow.role === 'STUDENT') {
      const { data: student } = await client
        .from('students')
        .select('current_class_id')
        .eq('user_id', userRow.id)
        .maybeSingle();
      if (!student?.current_class_id) return [];
      q = q.eq('class_id', student.current_class_id);
    } else if (userRow.role === 'PARENT') {
      // Show today's slots for the first linked student.
      const { data: guardian } = await client
        .from('guardians')
        .select('student:students!inner(current_class_id)')
        .eq('user_id', userRow.id)
        .limit(1)
        .maybeSingle();
      const classId = (guardian?.student as unknown as { current_class_id: string | null } | null)?.current_class_id;
      if (!classId) return [];
      q = q.eq('class_id', classId);
    }

    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async create(accessToken: string, input: CreateTimetableSlotInput) {
    const client = this.supabase.forUser(accessToken);
    await this.requireAdmin(client);

    const { data: school } = await client.from('schools').select('id').single();
    if (!school) throw new ForbiddenException('No school found');

    // Conflict detection: same class or same teacher, same day, overlapping times.
    const { data: existing } = await client
      .from('timetable_slots')
      .select('id, start_time, end_time, class_id, teacher_id')
      .eq('day_of_week', input.dayOfWeek)
      .or(`class_id.eq.${input.classId},teacher_id.eq.${input.teacherId}`);

    const conflicts = (existing ?? []).filter(
      (s) => input.startTime < s.end_time && input.endTime > s.start_time,
    );

    if (conflicts.length > 0) {
      const classConflict = conflicts.some((s) => s.class_id === input.classId);
      const teacherConflict = conflicts.some((s) => s.teacher_id === input.teacherId);
      const who = classConflict && teacherConflict
        ? 'This class and teacher are'
        : classConflict
        ? 'This class is'
        : 'This teacher is';
      throw new BadRequestException(
        `${who} already booked on ${input.dayOfWeek} between ${input.startTime}–${input.endTime}`,
      );
    }

    const { data, error } = await client
      .from('timetable_slots')
      .insert({
        id: randomUUID(),
        school_id: school.id,
        class_id: input.classId,
        subject_id: input.subjectId,
        teacher_id: input.teacherId,
        day_of_week: input.dayOfWeek,
        start_time: input.startTime,
        end_time: input.endTime,
        room: input.room ?? null,
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();
    if (error) throw new Error(error.message);

    await this.audit(client, school.id, 'timetable_slot.create', 'timetable_slot', data.id, {
      day: input.dayOfWeek,
      time: `${input.startTime}-${input.endTime}`,
    });
    return data;
  }

  async remove(accessToken: string, id: string) {
    const client = this.supabase.forUser(accessToken);
    await this.requireAdmin(client);

    const { data, error } = await client
      .from('timetable_slots')
      .delete()
      .eq('id', id)
      .select('id, school_id')
      .single();
    if (error) throw new Error(error.message);
    if (!data) throw new NotFoundException('Timetable slot not found');

    await this.audit(client, data.school_id, 'timetable_slot.delete', 'timetable_slot', id, {});
    return { deleted: true };
  }

  private async requireAdmin(client: ReturnType<SupabaseService['forUser']>) {
    const { data } = await client.from('users').select('role').maybeSingle();
    if (data?.role !== 'ADMIN') throw new ForbiddenException('Admin role required');
  }

  private async audit(client: ReturnType<SupabaseService['forUser']>, schoolId: string, action: string, entityType: string, entityId: string, metadata: unknown) {
    const { data: me } = await client.from('users').select('id').maybeSingle();
    await client.from('audit_logs').insert({
      id: randomUUID(), school_id: schoolId, user_id: me?.id ?? null,
      action, entity_type: entityType, entity_id: entityId, metadata,
    });
  }
}
