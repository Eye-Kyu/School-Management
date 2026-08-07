import { Injectable, ForbiddenException, BadRequestException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { SupabaseService } from '../supabase/supabase.service';
import type { CreateAssessmentInput, UpsertScoresInput } from '@school-manager/types';

const ASSESSMENT_COLUMNS = 'id, name, max_marks, assessment_date, created_at, term:terms(id, name), class:classes(id, name), subject:subjects(id, name, code)';

@Injectable()
export class AssessmentsService {
  constructor(private readonly supabase: SupabaseService) {}

  async list(accessToken: string, _authUserId: string, classId?: string) {
    const client = this.supabase.forUser(accessToken);
    const userRow = await this.supabase.currentUserRow(accessToken, 'id, role') as
      { id: string; role: string } | null;

    if (userRow?.role === 'ADMIN') {
      const { data, error } = await client
        .from('assessments')
        .select(ASSESSMENT_COLUMNS)
        .order('created_at', { ascending: false });
      if (error) throw new BadRequestException(error.message);
      return data ?? [];
    }

    const { data: teacher } = await client
      .from('teachers')
      .select('id, is_class_teacher_of')
      .eq('user_id', userRow?.id ?? '')
      .maybeSingle();

    if (!teacher) throw new ForbiddenException('Teacher record not found');

    // A Class Teacher viewing their own class sees every subject's
    // assessments for that class, not just the ones assigned to them. An
    // explicit classId the caller isn't the class teacher of is rejected
    // outright rather than silently falling back to their own generic
    // list — a caller asking for a specific class should get that class or
    // a clear denial, not an unrelated result set with a 200 status.
    if (classId) {
      if (teacher.is_class_teacher_of !== classId) {
        throw new ForbiddenException('You are not the class teacher of this class');
      }
      const { data, error } = await client
        .from('assessments')
        .select(ASSESSMENT_COLUMNS)
        .eq('class_id', classId)
        .order('created_at', { ascending: false });
      if (error) throw new BadRequestException(error.message);
      return data ?? [];
    }

    // Otherwise, a teacher's own assessments are the ones assigned to them
    // (teacher_id), not the ones they happened to click "create" on.
    const { data, error } = await client
      .from('assessments')
      .select(ASSESSMENT_COLUMNS)
      .eq('teacher_id', teacher.id)
      .order('created_at', { ascending: false });
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  // `link` is deliberately not part of the public CreateAssessmentInput Zod
  // schema — only internal callers (HomeworkService, QuizzesService) can set
  // source_type/source_id, never an arbitrary POST /assessments client.
  async create(
    accessToken: string,
    _authUserId: string,
    input: CreateAssessmentInput,
    link?: { sourceType: 'HOMEWORK' | 'QUIZ'; sourceId: string },
  ) {
    const client = this.supabase.forUser(accessToken);

    const { data: school } = await client.from('schools').select('id').single();
    if (!school) throw new ForbiddenException('No school found');

    const userRow = await this.supabase.currentUserRow(accessToken, 'id, role') as
      { id: string; role: string } | null;
    if (!userRow) throw new ForbiddenException('User record not found');

    let teacherId: string;
    if (userRow.role === 'ADMIN') {
      const { data: assignment } = await client
        .from('subject_assignments')
        .select('teacher_id')
        .eq('class_id', input.classId)
        .eq('subject_id', input.subjectId)
        .maybeSingle();
      if (!assignment) throw new BadRequestException('No teacher assigned to this class/subject combination');
      teacherId = assignment.teacher_id;
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
        source_type: link?.sourceType ?? 'DIRECT',
        source_id: link?.sourceId ?? null,
      })
      .select('id, name, max_marks, assessment_date, source_type, source_id, term:terms(name), class:classes(name), subject:subjects(name, code)')
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
      .select('id, school_id, source_type')
      .eq('id', assessmentId)
      .maybeSingle();
    if (!assessment) throw new NotFoundException('Assessment not found');

    // Grades on a linked assessment are derived — this is the API-layer half
    // of read-only enforcement; the DB trigger (write_linked_grade's
    // migration) is the real backstop against a direct-Supabase bypass.
    if (assessment.source_type !== 'DIRECT') {
      throw new ForbiddenException(`This grade is derived from ${assessment.source_type}. Update the source instead.`);
    }

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

  // Class Teacher (or admin) only — a class-wide grade summary CSV across
  // every subject, not just the caller's own. Mirrors the guard shape and
  // CSV convention already used by attendance.service.ts's exportCsv().
  async exportClassReport(accessToken: string, classId: string) {
    const client = this.supabase.forUser(accessToken);
    const userRow = await this.supabase.currentUserRow(accessToken, 'id, role') as
      { id: string; role: string } | null;

    if (userRow?.role === 'TEACHER') {
      const { data: teacherRow } = await client
        .from('teachers').select('is_class_teacher_of').eq('user_id', userRow.id).maybeSingle();
      if (teacherRow?.is_class_teacher_of !== classId) {
        throw new ForbiddenException('You are not the class teacher of this class');
      }
    } else if (userRow?.role !== 'ADMIN') {
      throw new ForbiddenException('Only a class teacher or admin can export a class report');
    }

    const { data: rows, error } = await client
      .from('grades')
      .select(`
        score, comment,
        assessment:assessments!inner(name, max_marks, assessment_date, class_id, subject:subjects(name)),
        student:students!inner(admission_no, user:users!inner(full_name))
      `)
      .eq('assessment.class_id', classId)
      .order('created_at', { ascending: false });
    if (error) throw new BadRequestException(error.message);

    type Row = {
      score: number | null; comment: string | null;
      assessment: { name: string; max_marks: number; assessment_date: string | null; subject: { name: string } | null };
      student: { admission_no: string; user: { full_name: string } };
    };
    const csvCell = (v: string) => (v.includes(',') || v.includes('"') || v.includes('\n') ? `"${v.replace(/"/g, '""')}"` : v);

    const { data: classRow } = await client.from('classes').select('name').eq('id', classId).maybeSingle();
    const today = new Date().toISOString().slice(0, 10);
    const header = 'AdmissionNo,Student,Subject,Assessment,Date,Score,MaxMarks,Comment';
    const lines = ((rows ?? []) as unknown as Row[]).map((r) => [
      r.student.admission_no, csvCell(r.student.user.full_name), csvCell(r.assessment.subject?.name ?? ''),
      csvCell(r.assessment.name), r.assessment.assessment_date ?? '', r.score ?? '', r.assessment.max_marks,
      csvCell(r.comment ?? ''),
    ].join(','));

    const className = classRow?.name ?? 'class';
    return {
      csv: [header, ...lines].join('\n'),
      filename: `grades_${className.replace(/\s+/g, '_')}_${today}.csv`,
    };
  }

  async getStudentGrades(accessToken: string, studentId: string, termId?: string) {
    const client = this.supabase.forUser(accessToken);

    let q = client
      .from('grades')
      .select('id, marks_obtained:score, comments:comment, assessment:assessments!inner(id, name, max_marks, assessment_date, term:terms(id, name), subject:subjects(id, name, code), class:classes(name))')
      .eq('student_id', studentId)
      .order('created_at', { ascending: false });

    if (termId) q = q.eq('assessments.term_id', termId);

    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }
}
