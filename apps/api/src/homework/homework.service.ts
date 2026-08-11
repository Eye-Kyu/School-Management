import { Injectable, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { normalizeScore } from '@school-manager/types';
import { SupabaseService } from '../supabase/supabase.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AssessmentsService } from '../assessments/assessments.service';
import type { CreateHomeworkInput, GradeHomeworkInput, LinkToGradebookInput } from '@school-manager/types';

@Injectable()
export class HomeworkService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly notifications: NotificationsService,
    private readonly assessments: AssessmentsService,
  ) {}

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
        .select('id, title, description, due_date, class_id, subject_id, teacher_id, max_score, created_at, class:classes(name), subject:subjects(name), completions:homework_completions(completed_at, score, grader_note, graded_at)')
        .eq('class_id', studentRow.current_class_id)
        .order('due_date', { ascending: true });
      if (error) throw new Error(error.message);

      return (data ?? []).map((h: Record<string, unknown>) => {
        const completions = h.completions as Array<{ completed_at: string; score: number | null; grader_note: string | null; graded_at: string | null }> | null;
        const completion = completions?.[0] ?? null;
        const { completions: _c, ...rest } = h;
        return {
          ...rest,
          completedAt: completion?.completed_at ?? null,
          score: completion?.score ?? null,
          graderNote: completion?.grader_note ?? null,
          gradedAt: completion?.graded_at ?? null,
        };
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
        .select('id, title, description, due_date, class_id, subject_id, teacher_id, max_score, created_at, class:classes(name), subject:subjects(name), completions:homework_completions(student_id, completed_at, score, grader_note, graded_at)')
        .eq('class_id', studentRow.current_class_id)
        .order('due_date', { ascending: true });
      if (error) throw new Error(error.message);

      return (data ?? []).map((h: Record<string, unknown>) => {
        const completions = h.completions as Array<{ student_id: string; completed_at: string; score: number | null; grader_note: string | null; graded_at: string | null }> | null;
        const match = completions?.find((c) => c.student_id === studentRow.id);
        const { completions: _c, ...rest } = h;
        return {
          ...rest,
          completedAt: match?.completed_at ?? null,
          score: match?.score ?? null,
          graderNote: match?.grader_note ?? null,
          gradedAt: match?.graded_at ?? null,
        };
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
        max_score: input.maxScore ?? null,
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

  // Grades an existing homework_completions row — only ever UPDATEs, never
  // creates one. A student who hasn't ticked "completed" has nothing to
  // grade yet (matches hw_comp_update RLS, which only ever grants UPDATE,
  // never INSERT, to TEACHER/ADMIN).
  async gradeSubmission(accessToken: string, homeworkId: string, submissionId: string, input: GradeHomeworkInput) {
    const client = this.supabase.forUser(accessToken);

    const userRow = await this.supabase.currentUserRow(accessToken, 'id, role') as { id: string; role: string } | null;
    if (!userRow || !['ADMIN', 'TEACHER'].includes(userRow.role)) {
      throw new ForbiddenException('Teacher or Admin role required');
    }

    // Fetch-check-then-write, not a blind update (see BUG-2, docs/bug-triage.md,
    // for exactly the anti-pattern this avoids: checking only `error`, never
    // whether a row was actually found/affected, before acting as if it succeeded).
    const { data: homework } = await client
      .from('homework_assignments')
      .select('id, title, class_id, teacher_id, max_score, school_id')
      .eq('id', homeworkId)
      .maybeSingle();
    if (!homework) throw new NotFoundException('Homework not found');

    const { data: submission } = await client
      .from('homework_completions')
      .select('id, student_id')
      .eq('id', submissionId)
      .eq('homework_id', homeworkId)
      .maybeSingle();
    if (!submission) throw new NotFoundException('Submission not found');

    if (userRow.role !== 'ADMIN') {
      const { data: teacherRow } = await client
        .from('teachers').select('id, is_class_teacher_of').eq('user_id', userRow.id).maybeSingle();
      const isCreator = teacherRow?.id === homework.teacher_id;
      const isClassTeacher = teacherRow?.is_class_teacher_of === homework.class_id;
      if (!isCreator && !isClassTeacher) {
        throw new ForbiddenException('Not authorized to grade this homework');
      }
    }

    if (homework.max_score != null && input.score > homework.max_score) {
      throw new BadRequestException(`Score cannot exceed the homework's max score (${homework.max_score})`);
    }

    const gradedAt = new Date().toISOString();
    // Explicit, fixed field list — never forwards arbitrary request-body
    // fields (e.g. completed_at is deliberately never touched here; RLS's
    // hw_comp_update policy governs row eligibility, not per-column scope,
    // so this is the actual enforcement for "grading only touches grading
    // columns," same approach as the BUG-6 read-state cascade).
    const { data: updated, error } = await client
      .from('homework_completions')
      .update({
        score: input.score,
        grader_note: input.graderNote ?? null,
        graded_at: gradedAt,
        graded_by_user_id: userRow.id,
      })
      .eq('id', submissionId)
      .select()
      .single();
    if (error) throw new Error(error.message);

    await client.from('audit_logs').insert({
      id: randomUUID(),
      school_id: homework.school_id,
      user_id: userRow.id,
      action: 'homework.grade',
      entity_type: 'homework_completion',
      entity_id: submissionId,
      metadata: { homeworkId, studentId: submission.student_id, score: input.score },
    });

    // Bucket 1, PR 2b: if this homework is linked to the gradebook, project
    // the score onto the linked assessment's scale and cascade it via
    // write_linked_grade() (the sole gateway grades_block_direct_edit_on_linked
    // allows to write a linked assessment's grades — see its migration).
    if (homework.max_score != null) {
      const { data: linkedAssessment } = await client
        .from('assessments')
        .select('id, max_marks')
        .eq('source_type', 'HOMEWORK')
        .eq('source_id', homeworkId)
        .maybeSingle();
      if (linkedAssessment) {
        const normalized = normalizeScore(input.score, homework.max_score, linkedAssessment.max_marks);
        const { error: cascadeError } = await client.rpc('write_linked_grade', {
          p_assessment_id: linkedAssessment.id,
          p_student_id: submission.student_id,
          p_score: normalized,
        });
        if (cascadeError) throw new Error(cascadeError.message);
      }
    }

    const { data: studentRow } = await client
      .from('students').select('user_id').eq('id', submission.student_id).maybeSingle();
    if (studentRow?.user_id) {
      await this.notifications.queue([{
        schoolId: homework.school_id,
        recipientId: studentRow.user_id,
        type: 'HOMEWORK_GRADED',
        title: `Homework graded — ${homework.title}`,
        body: homework.max_score
          ? `Your homework "${homework.title}" has been graded. Score: ${input.score}/${homework.max_score}.`
          : `Your homework "${homework.title}" has been graded. Score: ${input.score}.`,
        metadata: { homeworkId, submissionId },
      }]);
    }

    return updated;
  }

  // Creates (or, if already linked, updates) an assessment that this
  // homework's graded scores project onto. Idempotent-as-update: calling
  // this again on an already-linked homework updates the existing
  // assessment's metadata rather than creating a second one (the DB's
  // partial unique index on (source_type, source_id) would reject a second
  // one anyway, but this avoids ever attempting it).
  async linkToGradebook(accessToken: string, homeworkId: string, input: LinkToGradebookInput) {
    const client = this.supabase.forUser(accessToken);

    const userRow = await this.supabase.currentUserRow(accessToken, 'id, role') as { id: string; role: string } | null;
    if (!userRow || !['ADMIN', 'TEACHER'].includes(userRow.role)) {
      throw new ForbiddenException('Teacher or Admin role required');
    }

    const { data: homework } = await client
      .from('homework_assignments')
      .select('id, title, class_id, teacher_id, max_score, school_id')
      .eq('id', homeworkId)
      .maybeSingle();
    if (!homework) throw new NotFoundException('Homework not found');

    if (userRow.role !== 'ADMIN') {
      const { data: teacherRow } = await client
        .from('teachers').select('id').eq('user_id', userRow.id).maybeSingle();
      if (teacherRow?.id !== homework.teacher_id) {
        throw new ForbiddenException('Only the homework creator or an admin can link it to the gradebook');
      }
    }

    if (homework.max_score == null) {
      throw new BadRequestException('Set a max score on this homework before linking it to the gradebook');
    }

    const { data: existing } = await client
      .from('assessments')
      .select('id, max_marks')
      .eq('source_type', 'HOMEWORK')
      .eq('source_id', homeworkId)
      .maybeSingle();

    type GradedRow = { id: string; student_id: string; score: number; student: { user: { full_name: string } } | null };
    const { data: gradedRows } = await client
      .from('homework_completions')
      .select('id, student_id, score, student:students!inner(user:users!inner(full_name))')
      .eq('homework_id', homeworkId)
      .not('score', 'is', null) as { data: GradedRow[] | null };
    const { count: totalCount } = await client
      .from('homework_completions')
      .select('id', { count: 'exact', head: true })
      .eq('homework_id', homeworkId);

    const gradedCount = gradedRows?.length ?? 0;
    const ungradedCount = (totalCount ?? 0) - gradedCount;

    const needsRetroactiveConfirm = !existing && gradedCount > 0;
    const needsRecomputeConfirm = !!existing && existing.max_marks !== input.maxMarks && gradedCount > 0;

    if ((needsRetroactiveConfirm || needsRecomputeConfirm) && !input.confirmed) {
      const sampleGrades = (gradedRows ?? []).slice(0, 5).map((r) => ({
        studentName: r.student?.user?.full_name ?? 'Unknown',
        normalizedScore: normalizeScore(r.score, homework.max_score!, input.maxMarks),
      }));
      return {
        preview: true as const,
        kind: needsRecomputeConfirm ? ('recompute' as const) : ('retroactive_rollup' as const),
        gradedCount,
        ungradedCount,
        sampleGrades,
      };
    }

    let assessment: { id: string; name: string; max_marks: number; source_type: string; source_id: string | null };
    if (existing) {
      const { data, error } = await client
        .from('assessments')
        .update({
          name: input.name,
          subject_id: input.subjectId,
          class_id: input.classId,
          term_id: input.termId,
          max_marks: input.maxMarks,
        })
        .eq('id', existing.id)
        .select('id, name, max_marks, source_type, source_id')
        .single();
      if (error) throw new BadRequestException(error.message);
      assessment = data;
    } else {
      assessment = await this.assessments.create(
        accessToken,
        userRow.id,
        { name: input.name, subjectId: input.subjectId, classId: input.classId, termId: input.termId, maxMarks: input.maxMarks },
        { sourceType: 'HOMEWORK', sourceId: homeworkId },
      ) as typeof assessment;
    }

    if (gradedCount > 0) {
      await Promise.all((gradedRows ?? []).map((r) =>
        client.rpc('write_linked_grade', {
          p_assessment_id: assessment.id,
          p_student_id: r.student_id,
          p_score: normalizeScore(r.score, homework.max_score!, input.maxMarks),
        }),
      ));
    }

    await client.from('audit_logs').insert({
      id: randomUUID(),
      school_id: homework.school_id,
      user_id: userRow.id,
      action: !existing && gradedCount > 0 ? 'homework.retroactive_rollup'
        : needsRecomputeConfirm ? 'homework.retroactive_rollup'
        : 'homework.link_to_gradebook',
      entity_type: 'assessment',
      entity_id: assessment.id,
      metadata: { homeworkId, gradedCount, ungradedCount },
    });

    return assessment;
  }

  // Sets the linked assessment back to DIRECT — the assessment and its
  // existing grades are kept; future homework grading no longer cascades to it.
  async unlinkFromGradebook(accessToken: string, homeworkId: string) {
    const client = this.supabase.forUser(accessToken);

    const userRow = await this.supabase.currentUserRow(accessToken, 'id, role') as { id: string; role: string } | null;
    if (!userRow || !['ADMIN', 'TEACHER'].includes(userRow.role)) {
      throw new ForbiddenException('Teacher or Admin role required');
    }

    const { data: homework } = await client
      .from('homework_assignments').select('id, teacher_id, school_id').eq('id', homeworkId).maybeSingle();
    if (!homework) throw new NotFoundException('Homework not found');

    if (userRow.role !== 'ADMIN') {
      const { data: teacherRow } = await client
        .from('teachers').select('id').eq('user_id', userRow.id).maybeSingle();
      if (teacherRow?.id !== homework.teacher_id) {
        throw new ForbiddenException('Only the homework creator or an admin can unlink it');
      }
    }

    const { data: existing } = await client
      .from('assessments').select('id').eq('source_type', 'HOMEWORK').eq('source_id', homeworkId).maybeSingle();
    if (!existing) throw new NotFoundException('This homework is not linked to the gradebook');

    const { error } = await client
      .from('assessments').update({ source_type: 'DIRECT', source_id: null }).eq('id', existing.id);
    if (error) throw new Error(error.message);

    await client.from('audit_logs').insert({
      id: randomUUID(),
      school_id: homework.school_id,
      user_id: userRow.id,
      action: 'homework.unlink_from_gradebook',
      entity_type: 'assessment',
      entity_id: existing.id,
      metadata: { homeworkId },
    });

    return { unlinked: true };
  }
}
