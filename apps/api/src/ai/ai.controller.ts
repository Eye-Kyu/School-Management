import {
  Controller, Post, Body, Res, UseGuards, Get, Query,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import type { Response } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { AccessToken } from '../common/decorators/current-user.decorator';
import { AiService } from './ai.service';
import { SupabaseService } from '../supabase/supabase.service';

@ApiTags('ai')
@ApiBearerAuth()
@UseGuards(AuthGuard)
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

    // Fetch student name
    const { data: studentRow } = await this.supabase.admin
      .from('students')
      .select('user:users!user_id(full_name)')
      .eq('id', body.studentId)
      .maybeSingle();

    const studentName = (studentRow?.user as unknown as { full_name: string }[])?.[0]?.full_name ?? 'Student';

    // Fetch grade averages for this term
    const { data: assessments } = await client
      .from('assessments')
      .select('id, max_score, subject:subjects!subject_id(name)')
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
      if (score != null && a.max_score > 0) {
        subjectMap[subName]!.sum += (score / a.max_score) * 100;
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

  // ── AI Tutor (streaming SSE) ─────────────────────────────────

  @ApiOperation({ summary: 'Stream an AI tutor response grounded in school documents' })
  @Post('tutor')
  async tutor(
    @AccessToken() token: string,
    @Body() body: {
      question: string;
      documentIds?: string[];
      history?: { role: 'user' | 'assistant'; content: string }[];
    },
    @Res() res: Response,
  ) {
    const client = this.supabase.forUser(token);

    // Fetch relevant curriculum documents
    const docsQuery = client
      .from('documents')
      .select('title, file_url')
      .limit(5);

    if (body.documentIds?.length) {
      docsQuery.in('id', body.documentIds);
    }

    const { data: docs } = await docsQuery;

    // For text-based documents stored in DB — in production you'd fetch file content
    // For now we include the title as context; full RAG would fetch text from storage
    const documents = (docs ?? []).map((d) => ({
      title: d.title as string,
      content: `[Document: ${d.title} — available in school library]`,
    }));

    await this.ai.streamTutorResponse(
      body.question,
      documents,
      body.history ?? [],
      res,
    );
  }

  // ── Plagiarism detection ─────────────────────────────────────

  @ApiOperation({ summary: 'Detect AI-generated content or plagiarism in a submission' })
  @Post('detect-plagiarism')
  async detectPlagiarism(@Body() body: { text: string }) {
    return this.ai.detectPlagiarism(body.text);
  }
}
