import { Injectable, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { normalizeScore } from '@school-manager/types';
import { SupabaseService } from '../supabase/supabase.service';
import { AssessmentsService } from '../assessments/assessments.service';
import type { LinkToGradebookInput } from '@school-manager/types';

@Injectable()
export class QuizzesService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly assessments: AssessmentsService,
  ) {}

  // Creates (or, if already linked, updates) an assessment that this quiz's
  // submitted attempts project onto. Same idempotent-as-update shape as
  // HomeworkService.linkToGradebook() — see that method's comments for the
  // reasoning, not duplicated here.
  async linkToGradebook(accessToken: string, quizId: string, input: LinkToGradebookInput) {
    const client = this.supabase.forUser(accessToken);

    const userRow = await this.supabase.currentUserRow(accessToken, 'id, role') as { id: string; role: string } | null;
    if (!userRow || !['ADMIN', 'TEACHER'].includes(userRow.role)) {
      throw new ForbiddenException('Teacher or Admin role required');
    }

    const { data: quiz } = await client
      .from('quizzes')
      .select('id, title, class_id, created_by_id, school_id')
      .eq('id', quizId)
      .maybeSingle();
    if (!quiz) throw new NotFoundException('Quiz not found');

    // quizzes.created_by_id is a users.id (unlike homework_assignments.teacher_id,
    // which is a teachers.id) — compare directly against the resolved caller.
    if (userRow.role !== 'ADMIN' && quiz.created_by_id !== userRow.id) {
      throw new ForbiddenException('Only the quiz creator or an admin can link it to the gradebook');
    }

    const { data: existing } = await client
      .from('assessments')
      .select('id, max_marks')
      .eq('source_type', 'QUIZ')
      .eq('source_id', quizId)
      .maybeSingle();

    type AttemptRow = { id: string; student_id: string; score: number; max_score: number; student: { user: { full_name: string } } | null };
    const { data: submittedAttempts } = await client
      .from('quiz_attempts')
      .select('id, student_id, score, max_score, student:students!inner(user:users!inner(full_name))')
      .eq('quiz_id', quizId)
      .not('submitted_at', 'is', null) as { data: AttemptRow[] | null };
    const { count: totalCount } = await client
      .from('quiz_attempts')
      .select('id', { count: 'exact', head: true })
      .eq('quiz_id', quizId);

    // Only attempts with a positive max_score can be normalized (a
    // zero-question quiz has max_score = 0 — see the audit's own note on
    // this) — skip those from the graded count rather than crashing on them.
    const normalizable = (submittedAttempts ?? []).filter((a) => a.max_score > 0);
    const gradedCount = normalizable.length;
    const ungradedCount = (totalCount ?? 0) - gradedCount;

    const needsRetroactiveConfirm = !existing && gradedCount > 0;
    const needsRecomputeConfirm = !!existing && existing.max_marks !== input.maxMarks && gradedCount > 0;

    if ((needsRetroactiveConfirm || needsRecomputeConfirm) && !input.confirmed) {
      const sampleGrades = normalizable.slice(0, 5).map((a) => ({
        studentName: a.student?.user?.full_name ?? 'Unknown',
        normalizedScore: normalizeScore(a.score, a.max_score, input.maxMarks),
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
        { sourceType: 'QUIZ', sourceId: quizId },
      ) as typeof assessment;
    }

    if (gradedCount > 0) {
      await Promise.all(normalizable.map((a) =>
        client.rpc('write_linked_grade', {
          p_assessment_id: assessment.id,
          p_student_id: a.student_id,
          p_score: normalizeScore(a.score, a.max_score, input.maxMarks),
        }),
      ));
    }

    await client.from('audit_logs').insert({
      id: randomUUID(),
      school_id: quiz.school_id,
      user_id: userRow.id,
      action: !existing && gradedCount > 0 ? 'quiz.retroactive_rollup'
        : needsRecomputeConfirm ? 'quiz.retroactive_rollup'
        : 'quiz.link_to_gradebook',
      entity_type: 'assessment',
      entity_id: assessment.id,
      metadata: { quizId, gradedCount, ungradedCount },
    });

    return assessment;
  }

  async unlinkFromGradebook(accessToken: string, quizId: string) {
    const client = this.supabase.forUser(accessToken);

    const userRow = await this.supabase.currentUserRow(accessToken, 'id, role') as { id: string; role: string } | null;
    if (!userRow || !['ADMIN', 'TEACHER'].includes(userRow.role)) {
      throw new ForbiddenException('Teacher or Admin role required');
    }

    const { data: quiz } = await client
      .from('quizzes').select('id, created_by_id, school_id').eq('id', quizId).maybeSingle();
    if (!quiz) throw new NotFoundException('Quiz not found');

    if (userRow.role !== 'ADMIN' && quiz.created_by_id !== userRow.id) {
      throw new ForbiddenException('Only the quiz creator or an admin can unlink it');
    }

    const { data: existing } = await client
      .from('assessments').select('id').eq('source_type', 'QUIZ').eq('source_id', quizId).maybeSingle();
    if (!existing) throw new NotFoundException('This quiz is not linked to the gradebook');

    const { error } = await client
      .from('assessments').update({ source_type: 'DIRECT', source_id: null }).eq('id', existing.id);
    if (error) throw new Error(error.message);

    await client.from('audit_logs').insert({
      id: randomUUID(),
      school_id: quiz.school_id,
      user_id: userRow.id,
      action: 'quiz.unlink_from_gradebook',
      entity_type: 'assessment',
      entity_id: existing.id,
      metadata: { quizId },
    });

    return { unlinked: true };
  }
}
