import { Injectable, ForbiddenException, BadRequestException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { SupabaseService } from '../supabase/supabase.service';
import type { CreateAssessmentInput, UpsertScoresInput } from '@school-manager/types';

@Injectable()
export class AssessmentsService {
  constructor(private readonly supabase: SupabaseService) {}

  async list(accessToken: string, _authUserId: string) {
    const client = this.supabase.forUser(accessToken);
    const userRow = await this.supabase.currentUserRow(accessToken, 'id, role') as
      { id: string; role: string } | null;

    if (userRow?.role === 'ADMIN') {
      const { data, error } = await client
        .from('assessments')
        .select('id, name, max_marks:max_score, assessment_date:date, created_at, term:terms(id, name), class:classes(id, name), subject:subjects(id, name, code)')
        .order('created_at', { ascending: false });
      if (error) throw new BadRequestException(error.message);
      return data ?? [];
    }

    const { data: teacher } = await client
      .from('teachers')
      .select('id')
      .eq('user_id', userRow?.id ?? '')
      .maybeSingle();

    if (!teacher) throw new ForbiddenException('Teacher record not found');

    // `assessments` has no teacher_id column — a teacher's own assessments
    // are the ones they created (created_by_id), not a per-row FK to teachers.
    const { data, error } = await client
      .from('assessments')
      .select('id, name, max_marks:max_score, assessment_date:date, created_at, term:terms(id, name), class:classes(id, name), subject:subjects(id, name, code)')
      .eq('created_by_id', userRow!.id)
      .order('created_at', { ascending: false });
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async create(accessToken: string, _authUserId: string, input: CreateAssessmentInput) {
    const client = this.supabase.forUser(accessToken);

    const { data: school } = await client.from('schools').select('id').single();
    if (!school) throw new ForbiddenException('No school found');

    const userRow = await this.supabase.currentUserRow(accessToken, 'id, role') as
      { id: string; role: string } | null;
    if (!userRow) throw new ForbiddenException('User record not found');

    if (userRow.role === 'ADMIN') {
      const { data: assignment } = await client
        .from('subject_assignments')
        .select('teacher_id')
        .eq('class_id', input.classId)
        .eq('subject_id', input.subjectId)
        .maybeSingle();
      if (!assignment) throw new BadRequestException('No teacher assigned to this class/subject combination');
    } else if (userRow.role === 'TEACHER') {
      const { data: teacher } = await client
        .from('teachers')
        .select('id')
        .eq('user_id', userRow.id)
        .maybeSingle();
      if (!teacher) throw new ForbiddenException('Teacher record not found');

      const { data: assignment } = await client
        .from('subject_assignments')
        .select('id')
        .eq('teacher_id', teacher.id)
        .eq('class_id', input.classId)
        .eq('subject_id', input.subjectId)
        .maybeSingle();
      if (!assignment) throw new ForbiddenException('You are not assigned to teach this subject in this class');
    } else {
      throw new ForbiddenException('Only teachers and admins can create assessments');
    }

    // `assessments` has no description/teacher_id/updated_at columns; `kind`
    // is required with no client-facing equivalent, so default it to OTHER.
    const { data, error } = await client
      .from('assessments')
      .insert({
        id: randomUUID(),
        school_id: school.id,
        term_id: input.termId,
        class_id: input.classId,
        subject_id: input.subjectId,
        created_by_id: userRow.id,
        name: input.name,
        kind: 'OTHER',
        max_score: input.maxMarks,
        date: input.assessmentDate ?? null,
      })
      .select('id, name, max_marks:max_score, assessment_date:date, term:terms(name), class:classes(name), subject:subjects(name, code)')
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async getScores(accessToken: string, assessmentId: string) {
    const client = this.supabase.forUser(accessToken);

    const { data: assessment } = await client
      .from('assessments')
      .select('id, max_marks:max_score')
      .eq('id', assessmentId)
      .maybeSingle();
    if (!assessment) throw new NotFoundException('Assessment not found');

    const { data, error } = await client
      .from('grades')
      .select('id, marks_obtained:score, comments:comment, student:students!inner(id, admission_no, user:users!inner(full_name))')
      .eq('assessment_id', assessmentId);
    if (error) throw new BadRequestException(error.message);
    return { assessment, scores: data ?? [] };
  }

  async upsertScores(accessToken: string, assessmentId: string, input: UpsertScoresInput) {
    const client = this.supabase.forUser(accessToken);

    const { data: assessment } = await client
      .from('assessments')
      .select('id, school_id')
      .eq('id', assessmentId)
      .maybeSingle();
    if (!assessment) throw new NotFoundException('Assessment not found');

    const now = new Date().toISOString();
    const rows = input.scores.map((s) => ({
      id: randomUUID(),
      school_id: assessment.school_id,
      assessment_id: assessmentId,
      student_id: s.studentId,
      score: s.marksObtained ?? null,
      comment: s.comments ?? null,
      updated_at: now,
    }));

    const { error } = await client
      .from('grades')
      .upsert(rows, { onConflict: 'assessment_id,student_id' });
    if (error) throw new BadRequestException(error.message);

    return { saved: rows.length };
  }

  async deleteAssessment(accessToken: string, assessmentId: string) {
    const client = this.supabase.forUser(accessToken);
    const { error } = await client.from('assessments').delete().eq('id', assessmentId);
    if (error) throw new BadRequestException(error.message);
    return { deleted: true };
  }

  async getStudentGrades(accessToken: string, studentId: string, termId?: string) {
    const client = this.supabase.forUser(accessToken);

    let q = client
      .from('grades')
      .select('id, marks_obtained:score, comments:comment, assessment:assessments!inner(id, name, max_marks:max_score, assessment_date:date, term:terms(id, name), subject:subjects(id, name, code), class:classes(name))')
      .eq('student_id', studentId)
      .order('created_at', { ascending: false });

    if (termId) q = q.eq('assessments.term_id', termId);

    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }
}
