/**
 * AttendanceService.getApprovedAbsencesForStudent() — the new self-service
 * endpoint (Foundation PR, shared helpers) that gives STUDENT and
 * non-submitting-PARENT their first working path to see approved absences.
 * absence_requests_select RLS grants ADMIN, the specific requesting parent,
 * and the student's Class Teacher (plus any subject teacher) — but no
 * branch at all for "I am the student this is about" or "I am a guardian
 * who didn't personally submit this request" (see
 * docs/audits/shared-helpers-call-sites.md §1.3). This method's own access
 * rules are deliberately narrower than raw RLS (no subject-teacher branch —
 * that's the existing roster-badge use case, unaffected by this PR) and
 * enforce reason-visibility separately from read access.
 *
 * Supabase faked with a minimal per-table result queue, matching the
 * established pattern in homework.service.spec.ts /
 * notifications-aggregation.service.spec.ts. No network required.
 */

import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { AttendanceService } from '../attendance/attendance.service';
import type { SupabaseService } from '../supabase/supabase.service';
import type { NotificationsService } from '../notifications/notifications.service';

type TableResult = { data: unknown; error: unknown };

class FakeQueryBuilder implements PromiseLike<TableResult> {
  constructor(private readonly result: TableResult) {}
  select() { return this; }
  insert() { return this; }
  eq() { return this; }
  in() { return this; }
  lte() { return this; }
  gte() { return this; }
  maybeSingle() { return Promise.resolve(this.result); }
  then<TResult1 = TableResult, TResult2 = never>(
    onfulfilled?: ((value: TableResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.result).then(onfulfilled, onrejected);
  }
}

function makeFakeSupabase(opts: {
  userRow: { id: string; role: string; school_id: string } | null;
  tableQueues: Record<string, TableResult[]>;
}): SupabaseService {
  const queues: Record<string, TableResult[]> = {};
  for (const [table, results] of Object.entries(opts.tableQueues)) queues[table] = [...results];

  const admin = {
    from: (table: string) => {
      const queue = queues[table];
      const result = queue && queue.length > 0 ? queue.shift()! : { data: null, error: null };
      return new FakeQueryBuilder(result);
    },
  };

  return {
    admin,
    currentUserRow: async () => opts.userRow,
  } as unknown as SupabaseService;
}

function makeFakeNotifications(): NotificationsService {
  return {} as unknown as NotificationsService;
}

const STUDENT_ROW = { id: 'student-1', school_id: 'school-1', current_class_id: 'class-1', user_id: 'student-user-1' };

describe('AttendanceService.getApprovedAbsencesForStudent', () => {
  it('ADMIN sees full access including the reason', async () => {
    const supabase = makeFakeSupabase({
      userRow: { id: 'admin-user-1', role: 'ADMIN', school_id: 'school-1' },
      tableQueues: {
        students: [{ data: STUDENT_ROW, error: null }],
        absence_requests: [{
          data: [{
            id: 'req-1', start_date: '2026-01-05', end_date: '2026-01-05', reason: 'Family emergency',
            requested_by_user_id: 'parent-user-1', reviewed_by_user_id: 'admin-user-1', reviewed_at: '2026-01-04T10:00:00Z',
          }],
          error: null,
        }],
        users: [{ data: [{ id: 'admin-user-1', role: 'ADMIN' }], error: null }],
        audit_logs: [{ data: null, error: null }],
      },
    });
    const svc = new AttendanceService(supabase, makeFakeNotifications());

    const result = await svc.getApprovedAbsencesForStudent('token', 'student-1', { startDate: '2026-01-01', endDate: '2026-01-31' });

    expect(result.approved_absences).toHaveLength(1);
    expect(result.approved_absences[0]).toMatchObject({
      absence_date: '2026-01-05',
      approved_by_role: 'ADMIN',
      reason: 'Family emergency',
      submitted_by_current_user: false,
    });
  });

  it('the class Teacher of this student sees full access', async () => {
    const supabase = makeFakeSupabase({
      userRow: { id: 'teacher-user-1', role: 'TEACHER', school_id: 'school-1' },
      tableQueues: {
        students: [{ data: STUDENT_ROW, error: null }],
        teachers: [{ data: { is_class_teacher_of: 'class-1' }, error: null }],
        absence_requests: [{ data: [], error: null }],
        audit_logs: [{ data: null, error: null }],
      },
    });
    const svc = new AttendanceService(supabase, makeFakeNotifications());

    const result = await svc.getApprovedAbsencesForStudent('token', 'student-1', { startDate: '2026-01-01', endDate: '2026-01-31' });
    expect(result.approved_absences).toEqual([]);
  });

  it('a TEACHER who is NOT this student\'s class teacher is forbidden', async () => {
    const supabase = makeFakeSupabase({
      userRow: { id: 'teacher-user-2', role: 'TEACHER', school_id: 'school-1' },
      tableQueues: {
        students: [{ data: STUDENT_ROW, error: null }],
        teachers: [{ data: { is_class_teacher_of: 'some-other-class' }, error: null }],
      },
    });
    const svc = new AttendanceService(supabase, makeFakeNotifications());

    await expect(
      svc.getApprovedAbsencesForStudent('token', 'student-1', { startDate: '2026-01-01', endDate: '2026-01-31' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('the student themself sees their own record but the reason is always stripped', async () => {
    const supabase = makeFakeSupabase({
      userRow: { id: 'student-user-1', role: 'STUDENT', school_id: 'school-1' },
      tableQueues: {
        students: [{ data: STUDENT_ROW, error: null }],
        absence_requests: [{
          data: [{
            id: 'req-1', start_date: '2026-01-05', end_date: '2026-01-05', reason: 'Family emergency',
            requested_by_user_id: 'parent-user-1', reviewed_by_user_id: 'admin-user-1', reviewed_at: '2026-01-04T10:00:00Z',
          }],
          error: null,
        }],
        users: [{ data: [{ id: 'admin-user-1', role: 'ADMIN' }], error: null }],
        audit_logs: [{ data: null, error: null }],
      },
    });
    const svc = new AttendanceService(supabase, makeFakeNotifications());

    const result = await svc.getApprovedAbsencesForStudent('token', 'student-1', { startDate: '2026-01-01', endDate: '2026-01-31' });
    expect(result.approved_absences[0]).not.toHaveProperty('reason');
  });

  it('a student viewing another student\'s record is forbidden', async () => {
    const supabase = makeFakeSupabase({
      userRow: { id: 'some-other-student-user', role: 'STUDENT', school_id: 'school-1' },
      tableQueues: {
        students: [{ data: STUDENT_ROW, error: null }],
      },
    });
    const svc = new AttendanceService(supabase, makeFakeNotifications());

    await expect(
      svc.getApprovedAbsencesForStudent('token', 'student-1', { startDate: '2026-01-01', endDate: '2026-01-31' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('the submitting guardian sees the reason on their own submitted row', async () => {
    const supabase = makeFakeSupabase({
      userRow: { id: 'parent-user-1', role: 'PARENT', school_id: 'school-1' },
      tableQueues: {
        students: [{ data: STUDENT_ROW, error: null }],
        guardians: [{ data: { id: 'guardian-1' }, error: null }],
        absence_requests: [{
          data: [{
            id: 'req-1', start_date: '2026-01-05', end_date: '2026-01-05', reason: 'Family emergency',
            requested_by_user_id: 'parent-user-1', reviewed_by_user_id: 'admin-user-1', reviewed_at: '2026-01-04T10:00:00Z',
          }],
          error: null,
        }],
        users: [{ data: [{ id: 'admin-user-1', role: 'ADMIN' }], error: null }],
        audit_logs: [{ data: null, error: null }],
      },
    });
    const svc = new AttendanceService(supabase, makeFakeNotifications());

    const result = await svc.getApprovedAbsencesForStudent('token', 'student-1', { startDate: '2026-01-01', endDate: '2026-01-31' });
    expect(result.approved_absences[0]).toMatchObject({ reason: 'Family emergency', submitted_by_current_user: true });
  });

  it('a non-submitting guardian of the same student sees the day but not the reason', async () => {
    const supabase = makeFakeSupabase({
      userRow: { id: 'parent-user-2', role: 'PARENT', school_id: 'school-1' },
      tableQueues: {
        students: [{ data: STUDENT_ROW, error: null }],
        guardians: [{ data: { id: 'guardian-2' }, error: null }],
        absence_requests: [{
          data: [{
            id: 'req-1', start_date: '2026-01-05', end_date: '2026-01-05', reason: 'Family emergency',
            requested_by_user_id: 'parent-user-1', reviewed_by_user_id: 'admin-user-1', reviewed_at: '2026-01-04T10:00:00Z',
          }],
          error: null,
        }],
        users: [{ data: [{ id: 'admin-user-1', role: 'ADMIN' }], error: null }],
        audit_logs: [{ data: null, error: null }],
      },
    });
    const svc = new AttendanceService(supabase, makeFakeNotifications());

    const result = await svc.getApprovedAbsencesForStudent('token', 'student-1', { startDate: '2026-01-01', endDate: '2026-01-31' });
    expect(result.approved_absences[0]).not.toHaveProperty('reason');
    expect(result.approved_absences[0]!.submitted_by_current_user).toBe(false);
  });

  it('a PARENT with no guardian link to this student is forbidden', async () => {
    const supabase = makeFakeSupabase({
      userRow: { id: 'parent-user-3', role: 'PARENT', school_id: 'school-1' },
      tableQueues: {
        students: [{ data: STUDENT_ROW, error: null }],
        guardians: [{ data: null, error: null }],
      },
    });
    const svc = new AttendanceService(supabase, makeFakeNotifications());

    await expect(
      svc.getApprovedAbsencesForStudent('token', 'student-1', { startDate: '2026-01-01', endDate: '2026-01-31' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('a cross-tenant caller gets 404 (hides existence), not 403', async () => {
    const supabase = makeFakeSupabase({
      userRow: { id: 'admin-user-school-b', role: 'ADMIN', school_id: 'school-B' },
      tableQueues: {
        students: [{ data: STUDENT_ROW, error: null }], // school-1, caller is school-B
      },
    });
    const svc = new AttendanceService(supabase, makeFakeNotifications());

    await expect(
      svc.getApprovedAbsencesForStudent('token', 'student-1', { startDate: '2026-01-01', endDate: '2026-01-31' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('resolves approved_by_role from the reviewer\'s actual users.role — never a literal GUARDIAN value', async () => {
    // Guardians can submit but absence_requests_update RLS never lets one
    // approve — only ADMIN or the student's Class Teacher can. This locks
    // in Correction #2 from the Foundation PR plan.
    const supabase = makeFakeSupabase({
      userRow: { id: 'admin-user-1', role: 'ADMIN', school_id: 'school-1' },
      tableQueues: {
        students: [{ data: STUDENT_ROW, error: null }],
        absence_requests: [{
          data: [{
            id: 'req-1', start_date: '2026-01-05', end_date: '2026-01-05', reason: 'x',
            requested_by_user_id: 'parent-user-1', reviewed_by_user_id: 'teacher-user-1', reviewed_at: '2026-01-04T10:00:00Z',
          }],
          error: null,
        }],
        users: [{ data: [{ id: 'teacher-user-1', role: 'TEACHER' }], error: null }],
        audit_logs: [{ data: null, error: null }],
      },
    });
    const svc = new AttendanceService(supabase, makeFakeNotifications());

    const result = await svc.getApprovedAbsencesForStudent('token', 'student-1', { startDate: '2026-01-01', endDate: '2026-01-31' });
    expect(result.approved_absences[0]!.approved_by_role).toBe('TEACHER');
    expect(result.approved_absences[0]!.approved_by_role).not.toBe('GUARDIAN');
  });

  it('expands a multi-day approved request into one entry per day, clipped to the requested window', async () => {
    const supabase = makeFakeSupabase({
      userRow: { id: 'admin-user-1', role: 'ADMIN', school_id: 'school-1' },
      tableQueues: {
        students: [{ data: STUDENT_ROW, error: null }],
        absence_requests: [{
          data: [{
            // Request spans 01-03..01-06, but the caller only asked for 01-01..01-04.
            id: 'req-1', start_date: '2026-01-03', end_date: '2026-01-06', reason: 'Trip',
            requested_by_user_id: 'parent-user-1', reviewed_by_user_id: 'admin-user-1', reviewed_at: '2026-01-02T10:00:00Z',
          }],
          error: null,
        }],
        users: [{ data: [{ id: 'admin-user-1', role: 'ADMIN' }], error: null }],
        audit_logs: [{ data: null, error: null }],
      },
    });
    const svc = new AttendanceService(supabase, makeFakeNotifications());

    const result = await svc.getApprovedAbsencesForStudent('token', 'student-1', { startDate: '2026-01-01', endDate: '2026-01-04' });
    expect(result.approved_absences.map((a) => a.absence_date)).toEqual(['2026-01-03', '2026-01-04']);
  });
});
