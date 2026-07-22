import {
  Controller, Post, Body, Res, UseGuards, Get, Query, NotFoundException, ForbiddenException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { randomUUID } from 'crypto';
import type { Response } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { AccessToken, CurrentUser } from '../common/decorators/current-user.decorator';
import { FeatureGuard } from '../common/guards/feature.guard';
import { RequireModule } from '../common/decorators/require-module.decorator';
import { AiService } from './ai.service';
import { SupabaseService } from '../supabase/supabase.service';

@ApiTags('ai')
@ApiBearerAuth()
@UseGuards(AuthGuard, FeatureGuard)
@RequireModule('ai_features')
@Controller('ai')
export class AiController {
  constructor(
    private readonly ai: AiService,
    private readonly supabase: SupabaseService,
  ) {}

  // ── Quiz generation ──────────────────────────────────────────

  @ApiOperation({ summary: 'Generate quiz questions from text or PDF (base64)' })
  @Post('generate-quiz')
  async generateQuiz(
    @Body() body: {
      content: string;
      count?: number;
      contentType?: 'text' | 'pdf_base64';
    },
  ) {
    const questions = await this.ai.generateQuizQuestions(
      body.content,
      body.count ?? 10,
      body.contentType ?? 'text',
    );
    return { questions };
  }

  // ── Report card comment ──────────────────────────────────────

  @ApiOperation({ summary: 'Draft a report-card comment from student data' })
  @Post('report-card-comment')
  async reportCardComment(
    @AccessToken() token: string,
    @Body() body: {
      studentId: string;
      termId: string;
      teacherNotes?: string;
    },
  ) {
    const client = this.supabase.forUser(token);

    // RLS-scoped (students_select): only resolves for this school's ADMIN/
    // TEACHER, the student themself, or their guardian — a cross-school
    // studentId simply won't resolve.
    const { data: studentRow } = await client
      .from('students')
      .select('user:users!user_id(full_name)')
      .eq('id', body.studentId)
      .maybeSingle();
    if (!studentRow) throw new NotFoundException('Student not found');

    const studentName = (studentRow.user as unknown as { full_name: string }[])?.[0]?.full_name ?? 'Student';

    // Fetch grade averages for this term
    const { data: assessments } = await client
      .from('assessments')
      .select('id, max_marks, subject:subjects!subject_id(name)')
      .eq('term_id', body.termId);

    const aIds = (assessments ?? []).map((a) => a.id);
    const { data: grades } = aIds.length
      ? await client.from('grades').select('assessment_id, score').eq('student_id', body.studentId).in('assessment_id', aIds)
      : { data: [] };

    const gradeMap = Object.fromEntries((grades ?? []).map((g) => [g.assessment_id, g.score]));

    // Compute per-subject average
    const subjectMap: Record<string, { sum: number; count: number; name: string }> = {};
    for (const a of assessments ?? []) {
      const subName = (a.subject as unknown as { name: string }[])?.[0]?.name ?? 'Unknown';
      if (!subjectMap[subName]) subjectMap[subName] = { sum: 0, count: 0, name: subName };
      const score = gradeMap[a.id];
      if (score != null && a.max_marks > 0) {
        subjectMap[subName]!.sum += (score / a.max_marks) * 100;
        subjectMap[subName]!.count++;
      }
    }
    const subjectAverages = Object.values(subjectMap)
      .filter((s) => s.count > 0)
      .map((s) => ({ subject: s.name, avg: s.sum / s.count }));

    // Fetch attendance for the term
    const { data: termRow } = await client.from('terms').select('start_date, end_date').eq('id', body.termId).maybeSingle();
    let attendanceRate: number | null = null;
    if (termRow) {
      const { data: att } = await client
        .from('attendance_records')
        .select('status')
        .eq('student_id', body.studentId)
        .gte('date', termRow.start_date)
        .lte('date', termRow.end_date);
      const total = (att ?? []).length;
      if (total > 0) {
        const present = (att ?? []).filter((r) => r.status === 'PRESENT' || r.status === 'LATE').length;
        attendanceRate = (present / total) * 100;
      }
    }

    const comment = await this.ai.generateReportCardComment({
      studentName,
      subjectAverages,
      attendanceRate,
      teacherNotes: body.teacherNotes,
    });

    return { comment };
  }

  // ── Document processing (extract + chunk for tutor retrieval) ─

  @ApiOperation({ summary: 'Extract text from an uploaded document and chunk it for AI tutor retrieval' })
  @Post('process-document')
  async processDocument(
    @AccessToken() token: string,
    @Body() body: { documentId: string },
  ) {
    const client = this.supabase.forUser(token);

    // RLS-scoped (docs_select): only resolves for a document in the caller's
    // own school — no ownership check needed beyond letting RLS decide.
    const { data: doc } = await client
      .from('documents')
      .select('id, school_id, file_url, title')
      .eq('id', body.documentId)
      .maybeSingle();
    if (!doc) throw new NotFoundException('Document not found');

    // Chunk insertion needs the service-role client — chunks_insert RLS
    // requires ADMIN/TEACHER, but docs_select also permits STUDENT/PARENT,
    // so this stays on `admin` now that ownership is already verified above.
    const chunked = await this.ai.extractAndChunkDocument(doc.id, doc.school_id, doc.file_url, doc.title);
    return { chunked };
  }

  // ── AI Tutor (streaming SSE) ─────────────────────────────────

  @ApiOperation({ summary: 'Stream an AI tutor response grounded in school documents' })
  @Post('tutor')
  async tutor(
    @CurrentUser() user: { id: string },
    @Body() body: {
      question: string;
      documentIds?: string[];
      conversationId?: string;
      history?: { role: 'user' | 'assistant'; content: string }[];
    },
    @Res() res: Response,
  ) {
    const { data: userRow } = await this.supabase.admin
      .from('users')
      .select('id, school_id')
      .eq('auth_id', user.id)
      .maybeSingle();
    if (!userRow?.school_id) {
      throw new ForbiddenException('No school associated with this account');
    }

    // Retrieve relevant curriculum chunks via full-text search — real RAG,
    // not just document titles. Fail-closed: always scoped by school_id,
    // never an unscoped query.
    let chunksQuery = this.supabase.admin
      .from('document_chunks')
      .select('content, document_id, document:documents(title)')
      .eq('school_id', userRow.school_id)
      .textSearch('content', body.question, { type: 'plain', config: 'english' })
      .limit(8);

    if (body.documentIds?.length) {
      chunksQuery = chunksQuery.in('document_id', body.documentIds);
    }

    const { data: chunks } = await chunksQuery;

    const documents = (chunks ?? []).map((c) => ({
      title: (c.document as unknown as { title: string }[])?.[0]?.title ?? 'Untitled document',
      content: c.content as string,
    }));
    const documentTitles = [...new Set(documents.map((d) => d.title))];

    await this.ai.streamTutorResponse(
      body.question,
      documents,
      body.history ?? [],
      res,
      {
        schoolId: userRow?.school_id ?? null,
        studentId: userRow?.id ?? null,
        conversationId: body.conversationId ?? randomUUID(),
        documentTitles,
      },
    );
  }

  // ── Plagiarism detection ─────────────────────────────────────

  @ApiOperation({ summary: 'Detect AI-generated content or plagiarism in a submission' })
  @Post('detect-plagiarism')
  async detectPlagiarism(@Body() body: { text: string }) {
    return this.ai.detectPlagiarism(body.text);
  }
}
