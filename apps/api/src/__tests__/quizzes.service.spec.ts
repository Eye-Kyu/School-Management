/**
 * QuizzesService.linkToGradebook()/unlinkFromGradebook() unit tests —
 * Supabase faked with a minimal per-table result queue, matching the
 * established pattern in homework.service.spec.ts. No network required.
 */

import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { QuizzesService } from '../quizzes/quizzes.service';
import type { SupabaseService } from '../supabase/supabase.service';
import type { AssessmentsService } from '../assessments/assessments.service';

type TableResult = { data: unknown; error: unknown; count?: number };

class FakeQueryBuilder implements PromiseLike<TableResult> {
  constructor(private readonly result: TableResult) {}
  select() { return this; }
  update() { return this; }
  insert() { return this; }
  delete() { return this; }
  eq() { return this; }
  not() { return this; }
  limit() { return this; }
  order() { return this; }
  maybeSingle() { return Promise.resolve(this.result); }
  single() { return Promise.resolve(this.result); }
  then<TResult1 = TableResult, TResult2 = never>(
    onfulfilled?: ((value: TableResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.result).then(onfulfilled, onrejected);
  }
}

function makeFakeSupabase(opts: {
  userRow: { id: string; role: string };
  tableQueues: Record<string, TableResult[]>;
}): { service: SupabaseService; rpcMock: jest.Mock } {
  const queues: Record<string, TableResult[]> = {};
  for (const [table, results] of Object.entries(opts.tableQueues)) queues[table] = [...results];

  const rpcMock = jest.fn().mockResolvedValue({ data: null, error: null });
  const client = {
    from: (table: string) => {
      const queue = queues[table];
      const result = queue && queue.length > 0 ? queue.shift()! : { data: null, error: null };
      return new FakeQueryBuilder(result);
    },
    rpc: rpcMock,
  };

  const service = {
    forUser: () => client,
    currentUserRow: async () => opts.userRow,
  } as unknown as SupabaseService;

  return { service, rpcMock };
}

function makeFakeAssessments(): AssessmentsService {
  return {} as unknown as AssessmentsService;
}

function makeFakeAssessmentsWithCreate(): AssessmentsService & { create: jest.Mock } {
  return {
    create: jest.fn().mockResolvedValue({
      id: 'assessment-new', name: 'Quiz 1 (Quiz)', max_marks: 20, source_type: 'QUIZ', source_id: 'quiz-1',
    }),
  } as unknown as AssessmentsService & { create: jest.Mock };
}

const linkInput = {
  name: 'Quiz 1 (Quiz)',
  subjectId: 'subj-1',
  classId: 'class-1',
  termId: 'term-1',
  maxMarks: 20,
};

// quizzes.created_by_id is a users.id, unlike homework's teachers.id — the
// authorization check compares it directly against the caller's userRow.id.
describe('QuizzesService.linkToGradebook', () => {
  it('rejects a caller who is neither the quiz creator nor an admin', async () => {
    const { service: supabase } = makeFakeSupabase({
      userRow: { id: 'user-2', role: 'TEACHER' },
      tableQueues: {
        quizzes: [{ data: { id: 'quiz-1', title: 'Quiz 1', class_id: 'class-1', created_by_id: 'user-1', school_id: 'school-1' }, error: null }],
      },
    });
    const svc = new QuizzesService(supabase, makeFakeAssessmentsWithCreate());

    await expect(
      svc.linkToGradebook('token', 'quiz-1', linkInput),
    ).rejects.toThrow(ForbiddenException);
  });

  it('returns a retroactive-rollup preview instead of writing, when unconfirmed and submitted attempts already exist', async () => {
    const { service: supabase } = makeFakeSupabase({
      userRow: { id: 'user-1', role: 'TEACHER' },
      tableQueues: {
        quizzes: [{ data: { id: 'quiz-1', title: 'Quiz 1', class_id: 'class-1', created_by_id: 'user-1', school_id: 'school-1' }, error: null }],
        assessments: [{ data: null, error: null }], // not linked yet
        quiz_attempts: [
          {
            data: [
              { id: 'a1', student_id: 's1', score: 8, max_score: 10, student: { user: { full_name: 'Alice' } } },
              { id: 'a2', student_id: 's2', score: 6, max_score: 10, student: { user: { full_name: 'Bob' } } },
            ],
            error: null,
          },
          { data: null, error: null, count: 3 },
        ],
      },
    });
    const assessments = makeFakeAssessmentsWithCreate();
    const svc = new QuizzesService(supabase, assessments);

    const result = await svc.linkToGradebook('token', 'quiz-1', linkInput);

    expect(result).toEqual({
      preview: true,
      kind: 'retroactive_rollup',
      gradedCount: 2,
      ungradedCount: 1,
      sampleGrades: [
        { studentName: 'Alice', normalizedScore: 16 },
        { studentName: 'Bob', normalizedScore: 12 },
      ],
    });
    expect(assessments.create).not.toHaveBeenCalled();
  });

  it('excludes zero-max_score attempts (unscoreable) from the graded count', async () => {
    const { service: supabase } = makeFakeSupabase({
      userRow: { id: 'user-1', role: 'TEACHER' },
      tableQueues: {
        quizzes: [{ data: { id: 'quiz-1', title: 'Quiz 1', class_id: 'class-1', created_by_id: 'user-1', school_id: 'school-1' }, error: null }],
        assessments: [{ data: null, error: null }],
        quiz_attempts: [
          {
            data: [
              { id: 'a1', student_id: 's1', score: 8, max_score: 10, student: { user: { full_name: 'Alice' } } },
              { id: 'a2', student_id: 's2', score: 0, max_score: 0, student: { user: { full_name: 'Bob' } } },
            ],
            error: null,
          },
          { data: null, error: null, count: 2 },
        ],
      },
    });
    const assessments = makeFakeAssessmentsWithCreate();
    const svc = new QuizzesService(supabase, assessments);

    const result = await svc.linkToGradebook('token', 'quiz-1', linkInput);

    expect(result).toMatchObject({ preview: true, gradedCount: 1, ungradedCount: 1 });
  });

  it('creates the assessment and cascades grades to already-submitted attempts when confirmed', async () => {
    const { service: supabase, rpcMock } = makeFakeSupabase({
      userRow: { id: 'user-1', role: 'TEACHER' },
      tableQueues: {
        quizzes: [{ data: { id: 'quiz-1', title: 'Quiz 1', class_id: 'class-1', created_by_id: 'user-1', school_id: 'school-1' }, error: null }],
        assessments: [{ data: null, error: null }],
        quiz_attempts: [
          {
            data: [
              { id: 'a1', student_id: 's1', score: 8, max_score: 10, student: { user: { full_name: 'Alice' } } },
              { id: 'a2', student_id: 's2', score: 6, max_score: 10, student: { user: { full_name: 'Bob' } } },
            ],
            error: null,
          },
          { data: null, error: null, count: 2 },
        ],
      },
    });
    const assessments = makeFakeAssessmentsWithCreate();
    const svc = new QuizzesService(supabase, assessments);

    const result = await svc.linkToGradebook('token', 'quiz-1', { ...linkInput, confirmed: true });

    expect(result).toEqual({
      id: 'assessment-new', name: 'Quiz 1 (Quiz)', max_marks: 20, source_type: 'QUIZ', source_id: 'quiz-1',
    });
    expect(assessments.create).toHaveBeenCalledWith(
      'token',
      'user-1',
      { name: linkInput.name, subjectId: linkInput.subjectId, classId: linkInput.classId, termId: linkInput.termId, maxMarks: linkInput.maxMarks },
      { sourceType: 'QUIZ', sourceId: 'quiz-1' },
    );
    expect(rpcMock).toHaveBeenCalledTimes(2);
    expect(rpcMock).toHaveBeenCalledWith('write_linked_grade', { p_assessment_id: 'assessment-new', p_student_id: 's1', p_score: 16 });
    expect(rpcMock).toHaveBeenCalledWith('write_linked_grade', { p_assessment_id: 'assessment-new', p_student_id: 's2', p_score: 12 });
  });

  it('returns a recompute preview instead of writing, when unconfirmed and max_marks changes on an already-linked quiz', async () => {
    const { service: supabase } = makeFakeSupabase({
      userRow: { id: 'user-1', role: 'TEACHER' },
      tableQueues: {
        quizzes: [{ data: { id: 'quiz-1', title: 'Quiz 1', class_id: 'class-1', created_by_id: 'user-1', school_id: 'school-1' }, error: null }],
        assessments: [{ data: { id: 'assess-1', max_marks: 10 }, error: null }], // already linked, different max_marks
        quiz_attempts: [
          { data: [{ id: 'a1', student_id: 's1', score: 8, max_score: 10, student: { user: { full_name: 'Alice' } } }], error: null },
          { data: null, error: null, count: 1 },
        ],
      },
    });
    const assessments = makeFakeAssessmentsWithCreate();
    const svc = new QuizzesService(supabase, assessments);

    const result = await svc.linkToGradebook('token', 'quiz-1', linkInput); // maxMarks: 20 !== existing 10

    expect(result).toMatchObject({ preview: true, kind: 'recompute', gradedCount: 1, ungradedCount: 0 });
  });
});

describe('QuizzesService.unlinkFromGradebook', () => {
  it('sets the linked assessment back to DIRECT', async () => {
    const { service: supabase } = makeFakeSupabase({
      userRow: { id: 'user-1', role: 'TEACHER' },
      tableQueues: {
        quizzes: [{ data: { id: 'quiz-1', created_by_id: 'user-1', school_id: 'school-1' }, error: null }],
        assessments: [
          { data: { id: 'assess-1' }, error: null }, // existing lookup
          { data: null, error: null }, // update result
        ],
      },
    });
    const svc = new QuizzesService(supabase, makeFakeAssessments());

    const result = await svc.unlinkFromGradebook('token', 'quiz-1');
    expect(result).toEqual({ unlinked: true });
  });

  it('throws NotFoundException when the quiz is not linked', async () => {
    const { service: supabase } = makeFakeSupabase({
      userRow: { id: 'user-1', role: 'TEACHER' },
      tableQueues: {
        quizzes: [{ data: { id: 'quiz-1', created_by_id: 'user-1', school_id: 'school-1' }, error: null }],
        assessments: [{ data: null, error: null }],
      },
    });
    const svc = new QuizzesService(supabase, makeFakeAssessments());

    await expect(svc.unlinkFromGradebook('token', 'quiz-1')).rejects.toThrow(NotFoundException);
  });

  it('rejects a caller who is neither the quiz creator nor an admin', async () => {
    const { service: supabase } = makeFakeSupabase({
      userRow: { id: 'user-2', role: 'TEACHER' },
      tableQueues: {
        quizzes: [{ data: { id: 'quiz-1', created_by_id: 'user-1', school_id: 'school-1' }, error: null }],
      },
    });
    const svc = new QuizzesService(supabase, makeFakeAssessments());

    await expect(svc.unlinkFromGradebook('token', 'quiz-1')).rejects.toThrow(ForbiddenException);
  });
});
