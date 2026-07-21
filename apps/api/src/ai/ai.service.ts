import { Injectable, BadRequestException } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { SupabaseService } from '../supabase/supabase.service';

type QuizQuestion = {
  body: string;
  kind: 'MCQ' | 'SHORT_ANSWER';
  options?: { id: string; text: string }[];
  correct_option_id?: string | null;
  explanation: string;
  points: number;
};

@Injectable()
export class AiService {
  private anthropic: Anthropic;

  // Cached system prompts for each feature — stable content goes first
  private readonly QUIZ_SYSTEM = `You are an expert educational assessment designer for Kenyan schools.
Your task is to generate high-quality quiz questions from lesson material.

Rules:
- MCQ questions must have exactly 4 options labelled A, B, C, D
- Options should be plausible — avoid obviously wrong distractors
- Cover different cognitive levels: recall, comprehension, application
- SHORT_ANSWER questions should require 2–4 sentence answers
- Base questions only on the provided material
- Output ONLY valid JSON — no markdown, no prose`;

  private readonly REPORT_CARD_SYSTEM = `You are an experienced school teacher writing end-of-term report card comments for parents.

Style rules:
- 2–3 sentences maximum
- Warm, professional, and encouraging
- Honest but constructive — name both strengths and growth areas
- Specific to this student's data, not generic
- Appropriate for a Kenyan school context
- Output ONLY the comment text — no quotes, no labels, no preamble`;

  private readonly TUTOR_SYSTEM = `You are an on-curriculum AI tutor for a Kenyan school.
You help students understand topics covered in their school's own learning materials.

Critical rules:
- Answer ONLY using the provided curriculum documents
- If the answer is not in the documents, say: "I can only help with topics covered in your school's materials. Please ask your teacher about this."
- Do not introduce outside information, even if you know it
- Keep explanations simple and age-appropriate
- Encourage the student at the end
- You may ask one follow-up question to check understanding`;

  private readonly PLAGIARISM_SYSTEM = `You are an academic integrity specialist analyzing student submissions.
Assess whether the text shows signs of AI-generated content or plagiarism.

Output ONLY valid JSON with this exact structure:
{
  "ai_probability": 0.0,
  "plagiarism_risk": "low" | "medium" | "high",
  "flags": ["list of specific suspicious patterns"],
  "explanation": "one sentence summary",
  "recommendation": "pass" | "review" | "flag"
}`;

  constructor(
    private readonly config: ConfigService,
    private readonly supabase: SupabaseService,
  ) {
    this.anthropic = new Anthropic({
      apiKey: this.config.get<string>('ANTHROPIC_API_KEY'),
    });
  }

  // ── 1. Quiz Generation ───────────────────────────────────────

  async generateQuizQuestions(
    content: string,
    count = 10,
    contentType: 'text' | 'pdf_base64' = 'text',
  ): Promise<QuizQuestion[]> {
    const apiKey = this.config.get<string>('ANTHROPIC_API_KEY');
    if (!apiKey) throw new BadRequestException('AI features require ANTHROPIC_API_KEY in environment.');

    const userContent: Anthropic.MessageParam['content'] = contentType === 'pdf_base64'
      ? [
          {
            type: 'document' as const,
            source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: content },
          },
          {
            type: 'text' as const,
            text: `Generate exactly ${count} quiz questions from this document. Mix MCQ and SHORT_ANSWER questions. Return ONLY this JSON array:\n[{"body":"...","kind":"MCQ","options":[{"id":"A","text":"..."},...],"correct_option_id":"A","explanation":"...","points":1}]`,
          },
        ]
      : `Generate exactly ${count} quiz questions from this lesson content:\n\n${content}\n\nReturn ONLY a JSON array of question objects:\n[{"body":"...","kind":"MCQ","options":[{"id":"A","text":"..."},{"id":"B","text":"..."},{"id":"C","text":"..."},{"id":"D","text":"..."}],"correct_option_id":"A","explanation":"why this answer is correct","points":1}]\n\nFor SHORT_ANSWER, omit options and correct_option_id. Mix 7 MCQ and 3 SHORT_ANSWER.`;

    const response = await this.anthropic.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 4096,
      thinking: { type: 'adaptive' },
      system: [{ type: 'text', text: this.QUIZ_SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userContent }],
    });

    const text = response.content.find((b) => b.type === 'text');
    if (!text || text.type !== 'text') throw new BadRequestException('AI returned no text');

    try {
      // Strip any markdown code fences if present
      const json = text.text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
      const questions: QuizQuestion[] = JSON.parse(json);
      return questions;
    } catch {
      throw new BadRequestException('AI returned invalid JSON for quiz questions. Try again.');
    }
  }

  // ── 2. Report Card Comment ───────────────────────────────────

  async generateReportCardComment(input: {
    studentName: string;
    subjectAverages: { subject: string; avg: number }[];
    attendanceRate: number | null;
    teacherNotes?: string;
  }): Promise<string> {
    const apiKey = this.config.get<string>('ANTHROPIC_API_KEY');
    if (!apiKey) throw new BadRequestException('AI features require ANTHROPIC_API_KEY in environment.');

    const subjects = input.subjectAverages
      .map((s) => `${s.subject}: ${s.avg.toFixed(1)}%`)
      .join(', ');

    const prompt = `Student: ${input.studentName}
Subject averages: ${subjects || 'No grades recorded'}
Attendance: ${input.attendanceRate != null ? `${input.attendanceRate.toFixed(0)}%` : 'Not recorded'}
Teacher notes: ${input.teacherNotes?.trim() || 'None'}

Write a 2–3 sentence end-of-term comment for this student's report card.`;

    const response = await this.anthropic.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 256,
      system: [{ type: 'text', text: this.REPORT_CARD_SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content.find((b) => b.type === 'text');
    if (!text || text.type !== 'text') throw new BadRequestException('AI returned no comment');
    return text.text.trim();
  }

  // ── 3. AI Tutor (streaming SSE) ──────────────────────────────

  async streamTutorResponse(
    question: string,
    documents: { title: string; content: string }[],
    conversationHistory: { role: 'user' | 'assistant'; content: string }[],
    res: Response,
    logCtx: {
      schoolId: string | null;
      studentId: string | null;
      conversationId: string;
      documentTitles: string[];
    },
  ): Promise<void> {
    const apiKey = this.config.get<string>('ANTHROPIC_API_KEY');
    if (!apiKey) {
      res.write(`data: ${JSON.stringify({ error: 'AI features require ANTHROPIC_API_KEY' })}\n\n`);
      res.end();
      return;
    }

    // Build context from school documents
    const docsContext = documents.length > 0
      ? documents.map((d) => `### ${d.title}\n${d.content.slice(0, 4000)}`).join('\n\n---\n\n')
      : 'No curriculum documents are available. Direct the student to their teacher.';

    // SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const messages: Anthropic.MessageParam[] = [
      // Stable curriculum context — cached
      {
        role: 'user',
        content: [{
          type: 'text',
          text: `CURRICULUM DOCUMENTS:\n\n${docsContext}`,
          cache_control: { type: 'ephemeral' },
        }],
      },
      { role: 'assistant', content: 'I have read the curriculum materials. I am ready to help.' },
      // Conversation history
      ...conversationHistory.map((m) => ({ role: m.role, content: m.content })),
      // Current question
      { role: 'user', content: question },
    ];

    try {
      const stream = await this.anthropic.messages.stream({
        model: 'claude-opus-4-8',
        max_tokens: 1024,
        thinking: { type: 'adaptive' },
        system: [{ type: 'text', text: this.TUTOR_SYSTEM, cache_control: { type: 'ephemeral' } }],
        messages,
      });

      let fullAnswer = '';
      for await (const event of stream) {
        if (
          event.type === 'content_block_delta' &&
          event.delta.type === 'text_delta'
        ) {
          fullAnswer += event.delta.text;
          res.write(`data: ${JSON.stringify({ text: event.delta.text })}\n\n`);
        }
      }

      res.write('data: [DONE]\n\n');

      // Log the session for teacher review — best-effort, must never surface
      // as a stream error since the answer has already been fully sent.
      if (logCtx.schoolId && logCtx.studentId) {
        try {
          await this.supabase.admin.from('tutor_logs').insert({
            school_id: logCtx.schoolId,
            student_id: logCtx.studentId,
            conversation_id: logCtx.conversationId,
            question,
            answer: fullAnswer,
            documents_used: logCtx.documentTitles,
          });
        } catch {
          // Logging failures are non-fatal — the student already has their answer.
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'AI error';
      res.write(`data: ${JSON.stringify({ error: msg })}\n\n`);
    } finally {
      res.end();
    }
  }

  // ── 4b. Quiz feedback narratives ─────────────────────────────

  async generateQuizFeedback(
    quizTitle: string,
    questions: { body: string; kind: string; points: number }[],
    studentAnswers: { studentName: string; answers: Record<string, string>; scores: Record<string, number | null>; totalScore: number; maxScore: number }[],
  ): Promise<{ studentName: string; feedback: string }[]> {
    const apiKey = this.config.get<string>('ANTHROPIC_API_KEY');
    if (!apiKey) throw new BadRequestException('AI features require ANTHROPIC_API_KEY.');

    const questionSummary = questions.map((q, i) => `Q${i + 1} (${q.points}pt): ${q.body}`).join('\n');

    const feedbacks: { studentName: string; feedback: string }[] = [];

    for (const student of studentAnswers) {
      const pct = student.maxScore > 0 ? Math.round((student.totalScore / student.maxScore) * 100) : 0;
      const answerSummary = questions.map((q, i) => {
        const ans = student.answers[`q${i}`] ?? '(no answer)';
        const score = student.scores[`q${i}`];
        return `Q${i + 1}: "${ans}" → ${score ?? '?'}/${q.points}pt`;
      }).join('\n');

      const response = await this.anthropic.messages.create({
        model: 'claude-haiku-4-5', // Fast + cheap for per-student generation
        max_tokens: 200,
        system: [{ type: 'text', text: `You write brief, encouraging quiz feedback for school students.
Rules: 2-3 sentences. Name one specific strength and one specific improvement area based on their answers. Be warm and constructive.
Output ONLY the feedback text.`, cache_control: { type: 'ephemeral' } }],
        messages: [{
          role: 'user',
          content: `Quiz: ${quizTitle}\nStudent: ${student.studentName}\nScore: ${student.totalScore}/${student.maxScore} (${pct}%)\n\nQuestions:\n${questionSummary}\n\nAnswers:\n${answerSummary}\n\nWrite 2-3 sentences of feedback.`,
        }],
      });

      const text = response.content.find((b) => b.type === 'text');
      feedbacks.push({ studentName: student.studentName, feedback: text?.type === 'text' ? text.text.trim() : 'Great effort on this quiz!' });
    }

    return feedbacks;
  }

  // ── 4c. Document text extraction + chunking ──────────────────

  async extractAndChunkDocument(
    documentId: string,
    schoolId: string,
    fileUrl: string,
    title: string,
  ): Promise<number> {
    const apiKey = this.config.get<string>('ANTHROPIC_API_KEY');
    if (!apiKey) return 0;

    // Fetch the file content
    let text = '';
    try {
      const res = await fetch(fileUrl, { signal: AbortSignal.timeout(15_000) });
      const contentType = res.headers.get('content-type') ?? '';

      if (contentType.includes('pdf')) {
        // Send PDF to Claude for text extraction
        const ab = await res.arrayBuffer();
        const b64 = Buffer.from(ab).toString('base64');
        const extractRes = await this.anthropic.messages.create({
          model: 'claude-haiku-4-5',
          max_tokens: 4096,
          messages: [{
            role: 'user',
            content: [
              { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } },
              { type: 'text', text: 'Extract all text from this document. Return only the plain text, no formatting.' },
            ],
          }],
        });
        const block = extractRes.content.find((b) => b.type === 'text');
        text = block?.type === 'text' ? block.text : '';
      } else {
        text = await res.text();
      }
    } catch {
      return 0;
    }

    if (!text.trim()) return 0;

    // Split into chunks of ~500 words
    const words = text.split(/\s+/);
    const CHUNK_SIZE = 500;
    const chunks: string[] = [];
    for (let i = 0; i < words.length; i += CHUNK_SIZE) {
      chunks.push(words.slice(i, i + CHUNK_SIZE).join(' '));
    }

    // Delete old chunks for this document
    await this.supabase.admin.from('document_chunks').delete().eq('document_id', documentId);

    // Insert new chunks
    const rows = chunks.map((content, chunk_index) => ({
      school_id: schoolId,
      document_id: documentId,
      chunk_index,
      content,
    }));

    if (rows.length > 0) {
      await this.supabase.admin.from('document_chunks').insert(rows);
    }

    return chunks.length;
  }

  // ── 4. Plagiarism / AI-writing detection ─────────────────────

  async detectPlagiarism(submissionText: string): Promise<{
    ai_probability: number;
    plagiarism_risk: 'low' | 'medium' | 'high';
    flags: string[];
    explanation: string;
    recommendation: 'pass' | 'review' | 'flag';
  }> {
    const apiKey = this.config.get<string>('ANTHROPIC_API_KEY');
    if (!apiKey) {
      return {
        ai_probability: 0,
        plagiarism_risk: 'low',
        flags: ['AI detection unavailable — ANTHROPIC_API_KEY not set'],
        explanation: 'Detection skipped.',
        recommendation: 'pass',
      };
    }

    if (submissionText.length < 100) {
      return {
        ai_probability: 0,
        plagiarism_risk: 'low',
        flags: [],
        explanation: 'Submission too short to assess.',
        recommendation: 'pass',
      };
    }

    const response = await this.anthropic.messages.create({
      model: 'claude-haiku-4-5', // Cheap + fast for this task
      max_tokens: 512,
      system: [{ type: 'text', text: this.PLAGIARISM_SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{
        role: 'user',
        content: `Analyze this student submission for AI generation and plagiarism:\n\n---\n${submissionText.slice(0, 3000)}\n---\n\nReturn ONLY the JSON object.`,
      }],
    });

    const text = response.content.find((b) => b.type === 'text');
    if (!text || text.type !== 'text') {
      return { ai_probability: 0, plagiarism_risk: 'low', flags: [], explanation: 'Assessment failed', recommendation: 'pass' };
    }

    try {
      const json = text.text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
      return JSON.parse(json);
    } catch {
      return { ai_probability: 0, plagiarism_risk: 'low', flags: [], explanation: 'Could not parse result', recommendation: 'pass' };
    }
  }
}
