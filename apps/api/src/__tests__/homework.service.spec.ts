/**
 * HomeworkService.gradeSubmission() unit tests — Supabase faked with a
 * minimal per-table result queue, matching the established pattern in
 * notifications-aggregation.service.spec.ts. No network required.
 */

import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { HomeworkService } from '../homework/homework.service';
import type { SupabaseService } from '../supabase/supabase.service';
import type { NotificationsService } from '../notifications/notifications.service';

type TableResult = { data: unknown; error: unknown };

class FakeQueryBuilder implements PromiseLike<TableResult> {
  constructor(private readonly result: TableResult) {}
  select() { return this; }
  update() { return this; }
  insert() { return this; }
  eq() { return this; }
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
}): SupabaseService {
  const queues: Record<string, TableResult[]> = {};
  for (const [table, results] of Object.entries(opts.tableQueues)) queues[table] = [...results];

  const client = {
    from: (table: string) => {
      const queue = queues[table];
      const result = queue && queue.length > 0 ? queue.shift()! : { data: null, error: null };
      return new FakeQueryBuilder(result);
    },
  };

  return {
    forUser: () => client,
    currentUserRow: async () => opts.userRow,
  } as unknown as SupabaseService;
}

function makeFakeNotifications(): NotificationsService & { queue: jest.Mock } {
  return { queue: jest.fn().mockResolvedValue(undefined) } as unknown as NotificationsService & { queue: jest.Mock };
}

describe('HomeworkService.gradeSubmission', () => {
  it('rejects a score greater than the homework max_score', async () => {
    const supabase = makeFakeSupabase({
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
    const svc = new HomeworkService(supabase, makeFakeNotifications());

    await expect(
      svc.gradeSubmission('token', 'hw-1', 'sub-1', { score: 15 }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a caller who is neither the homework creator, the class teacher, nor an admin', async () => {
    const supabase = makeFakeSupabase({
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
    const svc = new HomeworkService(supabase, makeFakeNotifications());

    await expect(
      svc.gradeSubmission('token', 'hw-1', 'sub-1', { score: 5 }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('allows the class teacher (not the creator) to grade', async () => {
    const supabase = makeFakeSupabase({
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
    const svc = new HomeworkService(supabase, notifications);

    const result = await svc.gradeSubmission('token', 'hw-1', 'sub-1', { score: 8 });
    expect(result).toEqual({ score: 8, grader_note: null });
    expect(notifications.queue).toHaveBeenCalledTimes(1);
  });
});
