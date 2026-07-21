import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { SupabaseService } from '../supabase/supabase.service';
import type { CreateHomeworkInput } from '@school-manager/types';

@Injectable()
export class HomeworkService {
  constructor(private readonly supabase: SupabaseService) {}

  async list(accessToken: string) {
    const client = this.supabase.forUser(accessToken);

    const userRow = await this.supabase.currentUserRow(accessToken, 'id, role') as { id: string; role: string } | null;
    if (!userRow) throw new ForbiddenException('User not found');

    const role = userRow.role;

    if (role === 'ADMIN') {
      const { data, error } = await client
        .from('homework_assignments')
        .select('id, title, description, due_date, class_id, subject_id, teacher_id, created_at, class:classes(name), subject:subjects(name)')
        .order('due_date', { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []).map((h) => ({ ...h, completedAt: null }));
    }

    if (role === 'TEACHER') {
      const { data: teacherRow } = await client
        .from('teachers').select('id').eq('user_id', userRow.id).maybeSingle();
      if (!teacherRow) return [];

      const { data, error } = await client
        .from('homework_assignments')
        .select('id, title, description, due_date, class_id, subject_id, teacher_id, created_at, class:classes(name), subject:subjects(name)')
        .eq('teacher_id', teacherRow.id)
        .order('due_date', { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []).map((h) => ({ ...h, completedAt: null }));
    }

    if (role === 'STUDENT') {
      const { data: studentRow } = await client
        .from('students').select('id, current_class_id').eq('user_id', userRow.id).maybeSingle();
      if (!studentRow?.current_class_id) return [];

      const { data, error } = await client
        .from('homework_assignments')
        .select('id, title, description, due_date, class_id, subject_id, teacher_id, created_at, class:classes(name), subject:subjects(name), completions:homework_completions(completed_at)')
        .eq('class_id', studentRow.current_class_id)
        .order('due_date', { ascending: true });
      if (error) throw new Error(error.message);

      return (data ?? []).map((h: Record<string, unknown>) => {
        const completions = h.completions as Array<{ completed_at: string }> | null;
        const completedAt = completions?.[0]?.completed_at ?? null;
        const { completions: _c, ...rest } = h;
        return { ...rest, completedAt };
      });
    }

    if (role === 'PARENT') {
      // Find the first child's class (guardians → students)
      const { data: guardianRows } = await client
        .from('guardians').select('student_id').eq('user_id', userRow.id);
      if (!guardianRows?.length) return [];

      const studentId = guardianRows[0]!.student_id as string;
      const { data: studentRow } = await client
        .from('students').select('id, current_class_id').eq('id', studentId).maybeSingle();
      if (!studentRow?.current_class_id) return [];

      const { data, error } = await client
        .from('homework_assignments')
        .select('id, title, description, due_date, class_id, subject_id, teacher_id, created_at, class:classes(name), subject:subjects(name), completions:homework_completions(student_id, completed_at)')
        .eq('class_id', studentRow.current_class_id)
        .order('due_date', { ascending: true });
      if (error) throw new Error(error.message);

      return (data ?? []).map((h: Record<string, unknown>) => {
        const completions = h.completions as Array<{ student_id: string; completed_at: string }> | null;
        const match = completions?.find((c) => c.student_id === studentRow.id);
        const { completions: _c, ...rest } = h;
        return { ...rest, completedAt: match?.completed_at ?? null };
      });
    }

    return [];
  }

  async create(accessToken: string, authUserId: string, input: CreateHomeworkInput) {
    const client = this.supabase.forUser(accessToken);

    const { data: userRow } = await client
      .from('users').select('id, role').eq('auth_id', authUserId).maybeSingle();
    if (!userRow || !['ADMIN', 'TEACHER'].includes(userRow.role as string)) {
      throw new ForbiddenException('Teacher or Admin role required');
    }

    const { data: school } = await client.from('schools').select('id').single();
    if (!school) throw new ForbiddenException('No school found');

    // Resolve teacher ID (admins posting on behalf use a null teacher_id via service role)
    let teacherId: string | null = null;
    if (userRow.role === 'TEACHER') {
      const { data: teacherRow } = await client
        .from('teachers').select('id').eq('user_id', userRow.id).maybeSingle();
      teacherId = teacherRow?.id ?? null;
    } else {
      // ADMIN: look up any teacher for the class, or allow null
      const { data: teacherRow } = await this.supabase.admin
        .from('teachers')
        .select('id')
        .eq('school_id', school.id)
        .limit(1)
        .maybeSingle();
      teacherId = teacherRow?.id ?? null;
    }

    if (!teacherId) throw new ForbiddenException('No teacher record found');

    const id = randomUUID();
    const now = new Date().toISOString();
    const { data, error } = await client
      .from('homework_assignments')
      .insert({
        id,
        school_id: school.id,
        class_id: input.classId,
        subject_id: input.subjectId ?? null,
        teacher_id: teacherId,
        title: input.title,
        description: input.description ?? null,
        due_date: input.dueDate,
        updated_at: now,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);

    await client.from('audit_logs').insert({
      id: randomUUID(),
      school_id: school.id,
      user_id: userRow.id,
      action: 'homework.create',
      entity_type: 'homework_assignment',
      entity_id: id,
      metadata: { title: input.title, dueDate: input.dueDate, classId: input.classId },
    });

    return data;
  }

  async remove(accessToken: string, homeworkId: string) {
    const client = this.supabase.forUser(accessToken);

    const userRow = await this.supabase.currentUserRow(accessToken, 'id, role') as { id: string; role: string } | null;
    if (!userRow || !['ADMIN', 'TEACHER'].includes(userRow.role)) {
      throw new ForbiddenException('Teacher or Admin role required');
    }

    const { data: hw } = await client
      .from('homework_assignments').select('id').eq('id', homeworkId).maybeSingle();
    if (!hw) throw new NotFoundException('Homework not found');

    const { error } = await client.from('homework_assignments').delete().eq('id', homeworkId);
    if (error) throw new Error(error.message);
    return { deleted: true };
  }

  async complete(accessToken: string, homeworkId: string) {
    const client = this.supabase.forUser(accessToken);

    const userRow = await this.supabase.currentUserRow(accessToken, 'id, role') as { id: string; role: string } | null;
    if (userRow?.role !== 'STUDENT') throw new ForbiddenException('Student role required');

    const { data: studentRow } = await client
      .from('students').select('id').eq('user_id', userRow.id).maybeSingle();
    if (!studentRow) throw new ForbiddenException('Student record not found');

    const { data: school } = await client.from('schools').select('id').single();

    const completedAt = new Date().toISOString();
    const { error } = await client
      .from('homework_completions')
      .upsert({
        id: randomUUID(),
        school_id: school!.id,
        homework_id: homeworkId,
        student_id: studentRow.id,
        completed_at: completedAt,
      }, { onConflict: 'homework_id,student_id' });
    if (error) throw new Error(error.message);

    await client.from('audit_logs').insert({
      id: randomUUID(),
      school_id: school!.id,
      user_id: userRow.id,
      action: 'homework.complete',
      entity_type: 'homework_completion',
      entity_id: homeworkId,
      metadata: { homeworkId, studentId: studentRow.id, completedAt },
    });

    return { completed: true };
  }

  async uncomplete(accessToken: string, homeworkId: string) {
    const client = this.supabase.forUser(accessToken);

    const userRow = await this.supabase.currentUserRow(accessToken, 'id, role') as { id: string; role: string } | null;
    if (userRow?.role !== 'STUDENT') throw new ForbiddenException('Student role required');

    const { data: studentRow } = await client
      .from('students').select('id').eq('user_id', userRow.id).maybeSingle();
    if (!studentRow) throw new ForbiddenException('Student record not found');

    const { data: school } = await client.from('schools').select('id').single();

    const { error } = await client
      .from('homework_completions')
      .delete()
      .eq('homework_id', homeworkId)
      .eq('student_id', studentRow.id);
    if (error) throw new Error(error.message);

    await client.from('audit_logs').insert({
      id: randomUUID(),
      school_id: school!.id,
      user_id: userRow.id,
      action: 'homework.uncomplete',
      entity_type: 'homework_completion',
      entity_id: homeworkId,
      metadata: { homeworkId, studentId: studentRow.id },
    });

    return { completed: false };
  }
}
