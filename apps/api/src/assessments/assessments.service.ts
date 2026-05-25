import { Injectable, ForbiddenException, BadRequestException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { SupabaseService } from '../supabase/supabase.service';
import type { CreateAssessmentInput, UpsertScoresInput } from '@school-manager/types';

@Injectable()
export class AssessmentsService {
  constructor(private readonly supabase: SupabaseService) {}

  async list(accessToken: string, authUserId: string) {
    const client = this.supabase.forUser(accessToken);

    const { data: userRow } = await client
      .from('users')
      .select('role')
      .eq('auth_id', authUserId)
      .maybeSingle();

    if (userRow?.role === 'ADMIN') {
      const { data, error } = await client
        .from('assessments')
        .select('id, name, max_marks, assessment_date, created_at, term:terms(id, name), class:classes(id, name), subject:subjects(id, name, code)')
        .order('created_at', { ascending: false });
      if (error) throw new BadRequestException(error.message);
      return data ?? [];
    }

    const { data: teacher } = await client
      .from('teachers')
      .select('id')
      .eq('users.auth_id', authUserId)
      .maybeSingle();

    if (!teacher) throw new ForbiddenException('Teacher record not found');

    const { data, error } = await client
      .from('assessments')
      .select('id, name, max_marks, assessment_date, created_at, term:terms(id, name), class:classes(id, name), subject:subjects(id, name, code)')
      .eq('teacher_id', teacher.id)
      .order('created_at', { ascending: false });
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async create(accessToken: string, authUserId: string, input: CreateAssessmentInput) {
    const client = this.supabase.forUser(accessToken);

    const { data: school } = await client.from('schools').select('id').single();
    if (!school) throw new ForbiddenException('No school found');

    const { data: userRow } = await client
      .from('users')
      .select('role')
      .eq('auth_id', authUserId)
      .maybeSingle();

    let teacherId: string;

    if (userRow?.role === 'ADMIN') {
      const { data: assignment } = await client
        .from('subject_assignments')
        .select('teacher_id')
        .eq('class_id', input.classId)
        .eq('subject_id', input.subjectId)
        .maybeSingle();
      if (!assignment) throw new BadRequestException('No teacher assigned to this class/subject combination');
      teacherId = assignment.teacher_id;
    } else if (userRow?.role === 'TEACHER') {
      const { data: teacher } = await client
        .from('teachers')
        .select('id')
        .eq('users.auth_id', authUserId)
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

      teacherId = teacher.id;
    } else {
      throw new ForbiddenException('Only teachers and admins can create assessments');
    }

    const { data, error } = await client
      .from('assessments')
      .insert({
        id: randomUUID(),
        school_id: school.id,
        term_id: input.termId,
        class_id: input.classId,
        subject_id: input.subjectId,
        teacher_id: teacherId,
        name: input.name,
        description: input.description ?? null,
        max_marks: input.maxMarks,
        assessment_date: input.assessmentDate ?? null,
        updated_at: new Date().toISOString(),
      })
      .select('id, name, max_marks, assessment_date, term:terms(name), class:classes(name), subject:subjects(name, code)')
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async getScores(accessToken: string, assessmentId: string) {
    const client = this.supabase.forUser(accessToken);

    const { data: assessment } = await client
      .from('assessments')
      .select('id, max_marks')
      .eq('id', assessmentId)
      .maybeSingle();
    if (!assessment) throw new NotFoundException('Assessment not found');

    const { data, error } = await client
      .from('scores')
      .select('id, marks_obtained, comments, student:students!inner(id, admission_no, user:users!inner(full_name))')
      .eq('assessment_id', assessmentId);
    if (error) throw new BadRequestException(error.message);
    return { assessment, scores: data ?? [] };
  }

  async upsertScores(accessToken: string, assessmentId: string, input: UpsertScoresInput) {
    const client = this.supabase.forUser(accessToken);

    const { data: assessment } = await client
      .from('assessments')
      .select('id, school_id, max_marks')
      .eq('id', assessmentId)
      .maybeSingle();
    if (!assessment) throw new NotFoundException('Assessment not found');

    const now = new Date().toISOString();
    const rows = input.scores.map((s) => ({
      id: randomUUID(),
      school_id: assessment.school_id,
      assessment_id: assessmentId,
      student_id: s.studentId,
      marks_obtained: s.marksObtained ?? null,
      comments: s.comments ?? null,
      updated_at: now,
    }));

    const { error } = await client
      .from('scores')
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
      .from('scores')
      .select('id, marks_obtained, comments, assessment:assessments!inner(id, name, max_marks, assessment_date, term:terms(id, name), subject:subjects(id, name, code), class:classes(name))')
      .eq('student_id', studentId)
      .order('created_at', { ascending: false });

    if (termId) q = q.eq('assessments.term_id', termId);

    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }
}
