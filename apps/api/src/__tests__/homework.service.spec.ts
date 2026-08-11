/**
 * HomeworkService.gradeSubmission() unit tests — Supabase faked with a
 * minimal per-table result queue, matching the established pattern in
 * notifications-aggregation.service.spec.ts. No network required.
 */

import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { HomeworkService } from '../homework/homework.service';
import type { SupabaseService } from '../supabase/supabase.service';
import type { NotificationsService } from '../notifications/notifications.service';
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

function makeFakeNotifications(): NotificationsService & { queue: jest.Mock } {
  return { queue: jest.fn().mockResolvedValue(undefined) } as unknown as NotificationsService & { queue: jest.Mock };
}

function makeFakeAssessments(): AssessmentsService {
  return {} as unknown as AssessmentsService; // not exercised by gradeSubmission() when nothing is linked
}

function makeFakeAssessmentsWithCreate(): AssessmentsService & { create: jest.Mock } {
  return {
    create: jest.fn().mockResolvedValue({
      id: 'assessment-new', name: 'Essay (Homework)', max_marks: 20, source_type: 'HOMEWORK', source_id: 'hw-1',
    }),
  } as unknown as AssessmentsService & { create: jest.Mock };
}

describe('HomeworkService.gradeSubmission', () => {
  it('rejects a score greater than the homework max_score', async () => {
    const { service: supabase } = makeFakeSupabase({
      userRow: { id: 'teacher-user-1', role: 'TEACHER' },
      tableQueues: {
        homework_assignments: [{
          data: { id: 'hw-1', title: 'Essay', class_id: 'class-1', teacher_id: 'teacher-1', max_score: 10, school_id: 'school-1' },
          error: null,
        }],
        homework_completions: [{ data: { id: 'sub-1', student_id: 'student-1' }, error: null }],
        teachers: [{ data: { id: 'teacher-1', is_class_teacher_of: null }, error: null }],
      },
    });
    const svc = new HomeworkService(supabase, makeFakeNotifications(), makeFakeAssessments());

    await expect(
      svc.gradeSubmission('token', 'hw-1', 'sub-1', { score: 15 }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a caller who is neither the homework creator, the class teacher, nor an admin', async () => {
    const { service: supabase } = makeFakeSupabase({
      userRow: { id: 'teacher-user-2', role: 'TEACHER' },
      tableQueues: {
        homework_assignments: [{
          data: { id: 'hw-1', title: 'Essay', class_id: 'class-1', teacher_id: 'teacher-1', max_score: 10, school_id: 'school-1' },
          error: null,
        }],
        homework_completions: [{ data: { id: 'sub-1', student_id: 'student-1' }, error: null }],
        // A different teacher, not the creator (teacher-1) and not the class teacher of class-1.
        teachers: [{ data: { id: 'teacher-2', is_class_teacher_of: 'some-other-class' }, error: null }],
      },
    });
    const svc = new HomeworkService(supabase, makeFakeNotifications(), makeFakeAssessments());

    await expect(
      svc.gradeSubmission('token', 'hw-1', 'sub-1', { score: 5 }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('allows the class teacher (not the creator) to grade', async () => {
    const { service: supabase } = makeFakeSupabase({
      userRow: { id: 'teacher-user-3', role: 'TEACHER' },
      tableQueues: {
        homework_assignments: [{
          data: { id: 'hw-1', title: 'Essay', class_id: 'class-1', teacher_id: 'teacher-1', max_score: 10, school_id: 'school-1' },
          error: null,
        }],
        homework_completions: [
          { data: { id: 'sub-1', student_id: 'student-1' }, error: null }, // existence check
          { data: { score: 8, grader_note: null }, error: null }, // update result
        ],
        teachers: [{ data: { id: 'teacher-3', is_class_teacher_of: 'class-1' }, error: null }],
        students: [{ data: { user_id: 'student-user-1' }, error: null }],
      },
    });
    const notifications = makeFakeNotifications();
    const svc = new HomeworkService(supabase, notifications, makeFakeAssessments());

    const result = await svc.gradeSubmission('token', 'hw-1', 'sub-1', { score: 8 });
    expect(result).toEqual({ score: 8, grader_note: null });
    expect(notifications.queue).toHaveBeenCalledTimes(1);
  });
});

const linkInput = {
  name: 'Essay (Homework)',
  subjectId: 'subj-1',
  classId: 'class-1',
  termId: 'term-1',
  maxMarks: 20,
};

describe('HomeworkService.linkToGradebook', () => {
  it('rejects a caller who is neither the homework creator nor an admin', async () => {
    const { service: supabase } = makeFakeSupabase({
      userRow: { id: 'teacher-user-2', role: 'TEACHER' },
      tableQueues: {
        homework_assignments: [{
          data: { id: 'hw-1', title: 'Essay', class_id: 'class-1', teacher_id: 'teacher-1', max_score: 10, school_id: 'school-1' },
          error: null,
        }],
        teachers: [{ data: { id: 'teacher-2' }, error: null }],
      },
    });
    const svc = new HomeworkService(supabase, makeFakeNotifications(), makeFakeAssessmentsWithCreate());

    await expect(
      svc.linkToGradebook('token', 'hw-1', linkInput),
    ).rejects.toThrow(ForbiddenException);
  });

  it('rejects linking a homework with no max_score set', async () => {
    const { service: supabase } = makeFakeSupabase({
      userRow: { id: 'teacher-user-1', role: 'TEACHER' },
      tableQueues: {
        homework_assignments: [{
          data: { id: 'hw-1', title: 'Essay', class_id: 'class-1', teacher_id: 'teacher-1', max_score: null, school_id: 'school-1' },
          error: null,
        }],
        teachers: [{ data: { id: 'teacher-1' }, error: null }],
      },
    });
    const svc = new HomeworkService(supabase, makeFakeNotifications(), makeFakeAssessmentsWithCreate());

    await expect(
      svc.linkToGradebook('token', 'hw-1', linkInput),
    ).rejects.toThrow(BadRequestException);
  });

  it('returns a retroactive-rollup preview instead of writing, when unconfirmed and graded work already exists', async () => {
    const { service: supabase } = makeFakeSupabase({
      userRow: { id: 'teacher-user-1', role: 'TEACHER' },
      tableQueues: {
        homework_assignments: [{
          data: { id: 'hw-1', title: 'Essay', class_id: 'class-1', teacher_id: 'teacher-1', max_score: 10, school_id: 'school-1' },
          error: null,
        }],
        teachers: [{ data: { id: 'teacher-1' }, error: null }],
        assessments: [{ data: null, error: null }], // not linked yet
        homework_completions: [
          {
            data: [
              { id: 'c1', student_id: 's1', score: 8, student: { user: { full_name: 'Alice' } } },
              { id: 'c2', student_id: 's2', score: 6, student: { user: { full_name: 'Bob' } } },
            ],
            error: null,
          },
          { data: null, error: null, count: 3 },
        ],
      },
    });
    const assessments = makeFakeAssessmentsWithCreate();
    const svc = new HomeworkService(supabase, makeFakeNotifications(), assessments);

    const result = await svc.linkToGradebook('token', 'hw-1', linkInput);

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

  it('creates the assessment and cascades grades to already-graded students when confirmed', async () => {
    const { service: supabase, rpcMock } = makeFakeSupabase({
      userRow: { id: 'teacher-user-1', role: 'TEACHER' },
      tableQueues: {
        homework_assignments: [{
          data: { id: 'hw-1', title: 'Essay', class_id: 'class-1', teacher_id: 'teacher-1', max_score: 10, school_id: 'school-1' },
          error: null,
        }],
        teachers: [{ data: { id: 'teacher-1' }, error: null }],
        assessments: [{ data: null, error: null }],
        homework_completions: [
          {
            data: [
              { id: 'c1', student_id: 's1', score: 8, student: { user: { full_name: 'Alice' } } },
              { id: 'c2', student_id: 's2', score: 6, student: { user: { full_name: 'Bob' } } },
            ],
            error: null,
          },
          { data: null, error: null, count: 3 },
        ],
      },
    });
    const assessments = makeFakeAssessmentsWithCreate();
    const svc = new HomeworkService(supabase, makeFakeNotifications(), assessments);

    const result = await svc.linkToGradebook('token', 'hw-1', { ...linkInput, confirmed: true });

    expect(result).toEqual({
      id: 'assessment-new', name: 'Essay (Homework)', max_marks: 20, source_type: 'HOMEWORK', source_id: 'hw-1',
    });
    expect(assessments.create).toHaveBeenCalledWith(
      'token',
      'teacher-user-1',
      { name: linkInput.name, subjectId: linkInput.subjectId, classId: linkInput.classId, termId: linkInput.termId, maxMarks: linkInput.maxMarks },
      { sourceType: 'HOMEWORK', sourceId: 'hw-1' },
    );
    expect(rpcMock).toHaveBeenCalledTimes(2);
    expect(rpcMock).toHaveBeenCalledWith('write_linked_grade', { p_assessment_id: 'assessment-new', p_student_id: 's1', p_score: 16 });
    expect(rpcMock).toHaveBeenCalledWith('write_linked_grade', { p_assessment_id: 'assessment-new', p_student_id: 's2', p_score: 12 });
  });

  it('returns a recompute preview instead of writing, when unconfirmed and max_marks changes on an already-linked homework', async () => {
    const { service: supabase } = makeFakeSupabase({
      userRow: { id: 'teacher-user-1', role: 'TEACHER' },
      tableQueues: {
        homework_assignments: [{
          data: { id: 'hw-1', title: 'Essay', class_id: 'class-1', teacher_id: 'teacher-1', max_score: 10, school_id: 'school-1' },
          error: null,
        }],
        teachers: [{ data: { id: 'teacher-1' }, error: null }],
        assessments: [{ data: { id: 'assess-1', max_marks: 10 }, error: null }], // already linked, different max_marks
        homework_completions: [
          { data: [{ id: 'c1', student_id: 's1', score: 8, student: { user: { full_name: 'Alice' } } }], error: null },
          { data: null, error: null, count: 1 },
        ],
      },
    });
    const assessments = makeFakeAssessmentsWithCreate();
    const svc = new HomeworkService(supabase, makeFakeNotifications(), assessments);

    const result = await svc.linkToGradebook('token', 'hw-1', linkInput); // maxMarks: 20 !== existing 10

    expect(result).toMatchObject({ preview: true, kind: 'recompute', gradedCount: 1, ungradedCount: 0 });
  });
});

describe('HomeworkService.unlinkFromGradebook', () => {
  it('sets the linked assessment back to DIRECT', async () => {
    const { service: supabase } = makeFakeSupabase({
      userRow: { id: 'teacher-user-1', role: 'TEACHER' },
      tableQueues: {
        homework_assignments: [{ data: { id: 'hw-1', teacher_id: 'teacher-1', school_id: 'school-1' }, error: null }],
        teachers: [{ data: { id: 'teacher-1' }, error: null }],
        assessments: [
          { data: { id: 'assess-1' }, error: null }, // existing lookup
          { data: null, error: null }, // update result
        ],
      },
    });
    const svc = new HomeworkService(supabase, makeFakeNotifications(), makeFakeAssessments());

    const result = await svc.unlinkFromGradebook('token', 'hw-1');
    expect(result).toEqual({ unlinked: true });
  });

  it('throws NotFoundException when the homework is not linked', async () => {
    const { service: supabase } = makeFakeSupabase({
      userRow: { id: 'teacher-user-1', role: 'TEACHER' },
      tableQueues: {
        homework_assignments: [{ data: { id: 'hw-1', teacher_id: 'teacher-1', school_id: 'school-1' }, error: null }],
        teachers: [{ data: { id: 'teacher-1' }, error: null }],
        assessments: [{ data: null, error: null }],
      },
    });
    const svc = new HomeworkService(supabase, makeFakeNotifications(), makeFakeAssessments());

    await expect(svc.unlinkFromGradebook('token', 'hw-1')).rejects.toThrow(NotFoundException);
  });

  it('rejects a caller who is neither the homework creator nor an admin', async () => {
    const { service: supabase } = makeFakeSupabase({
      userRow: { id: 'teacher-user-2', role: 'TEACHER' },
      tableQueues: {
        homework_assignments: [{ data: { id: 'hw-1', teacher_id: 'teacher-1', school_id: 'school-1' }, error: null }],
        teachers: [{ data: { id: 'teacher-2' }, error: null }],
      },
    });
    const svc = new HomeworkService(supabase, makeFakeNotifications(), makeFakeAssessments());

    await expect(svc.unlinkFromGradebook('token', 'hw-1')).rejects.toThrow(ForbiddenException);
  });
});
