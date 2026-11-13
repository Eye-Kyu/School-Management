/**
 * Regression tests for the V3 code fixes from the 2026-11 security audit
 * (docs/audits/security-audit-2026-11-tracker.md): SA-38, SA-39, SA-40,
 * SA-45, SA-47. Pure unit tests: Supabase is faked per table; no network.
 *
 * Follows the established FakeQueryBuilder copy-paste pattern (CLAUDE.md §7).
 */

import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { AbsenceRequestsService } from '../absence-requests/absence-requests.service';
import { AttendanceService } from '../attendance/attendance.service';
import { Student360Service } from '../students/student-360.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuthController, allowFailedLoginReport } from '../auth/auth.controller';
import type { SupabaseService } from '../supabase/supabase.service';
import type { AfricasTalkingClient } from '../notifications/africastalking.client';

type TableResult = { data: unknown; error: unknown };

class FakeQueryBuilder implements PromiseLike<TableResult> {
  constructor(private readonly result: TableResult, private readonly onWrite?: (op: string, payload: unknown) => void) {}
  select() { return this; }
  eq() { return this; }
  neq() { return this; }
  in() { return this; }
  is() { return this; }
  lte() { return this; }
  gte() { return this; }
  order() { return this; }
  limit() { return this; }
  update(payload: unknown) { this.onWrite?.('update', payload); return this; }
  insert(payload: unknown) { this.onWrite?.('insert', payload); return this; }
  maybeSingle() { return Promise.resolve(this.result); }
  single() { return Promise.resolve(this.result); }
  then<R1 = TableResult, R2 = never>(
    onFulfilled?: ((v: TableResult) => R1 | PromiseLike<R1>) | null,
    onRejected?: ((e: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return Promise.resolve(this.result).then(onFulfilled, onRejected);
  }
}

type Tables = Record<string, TableResult | TableResult[]>;

/** Each table returns its result; an array is consumed one result per call. */
function fakeSupabase(opts: { me: unknown; admin?: Tables; user?: Tables; writes?: Array<[string, string, unknown]> }) {
  const make = (tables: Tables = {}) => ({
    from: (table: string) => {
      const entry = tables[table];
      const result = Array.isArray(entry) ? (entry.shift() ?? { data: null, error: null }) : (entry ?? { data: null, error: null });
      return new FakeQueryBuilder(result, (op, payload) => opts.writes?.push([table, op, payload]));
    },
  });
  return {
    currentUserRow: async () => opts.me,
    admin: make(opts.admin),
    forUser: () => make(opts.user),
  } as unknown as SupabaseService;
}

const fakeConfig = (values: Record<string, string | undefined>) =>
  ({ get: (k: string) => values[k] }) as unknown as ConfigService;

// ── SA-39 / SA-47: null class never matches a non-class-teacher ─────────────
describe('class-teacher checks with a classless student (SA-39, SA-47)', () => {
  const teacher = { id: 'u-t', role: 'TEACHER', school_id: 'school-a' };
  const classless = { id: 'stu-1', school_id: 'school-a', current_class_id: null, user_id: 'u-s' };

  it('Student 360 refuses a non-class teacher for a student with no class', async () => {
    const svc = new Student360Service(fakeSupabase({
      me: teacher,
      admin: { students: { data: classless, error: null }, teachers: { data: { is_class_teacher_of: null }, error: null } },
    }));
    await expect(svc.getStudent360('tok', 'stu-1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('approved absences refuse a non-class teacher for a student with no class', async () => {
    const svc = new AttendanceService(fakeSupabase({
      me: teacher,
      admin: { students: { data: classless, error: null }, teachers: { data: { is_class_teacher_of: null }, error: null } },
    }), {} as NotificationsService);
    await expect(
      svc.getApprovedAbsencesForStudent('tok', 'stu-1', { startDate: '2026-01-01', endDate: '2026-01-31' } as never),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

// ── SA-38: an RLS-filtered review is a refusal, with no side effects ────────
describe('AbsenceRequestsService.review (SA-38)', () => {
  const pending = { id: 'req-1', school_id: 'school-a', student_id: 'stu-1', requested_by_user_id: 'u-p', start_date: '2026-01-05', end_date: '2026-01-06', status: 'PENDING' };

  function setup(updateResult: TableResult) {
    const writes: Array<[string, string, unknown]> = [];
    const queue = jest.fn();
    const svc = new AbsenceRequestsService(
      fakeSupabase({
        me: { id: 'u-subject-teacher', role: 'TEACHER', school_id: 'school-a' },
        user: { absence_requests: [{ data: pending, error: null }, updateResult] },
        writes,
      }),
      { queue } as unknown as NotificationsService,
    );
    return { svc, writes, queue };
  }

  it('throws and sends no notification when the update matched zero rows', async () => {
    const { svc, writes, queue } = setup({ data: [], error: null });
    await expect(svc.review('tok', 'req-1', { action: 'APPROVE' } as never)).rejects.toBeInstanceOf(ForbiddenException);
    expect(queue).not.toHaveBeenCalled();
    expect(writes.filter(([t, op]) => t === 'audit_logs' && op === 'insert')).toHaveLength(0);
  });
});

// ── SA-40: failed-login reports are unattributed and capped ─────────────────
describe('AuthController.logFailedLogin (SA-40)', () => {
  it('records no user or school, even when the email matches a real user', async () => {
    const writes: Array<[string, string, unknown]> = [];
    const ctrl = new AuthController(fakeSupabase({
      me: null,
      admin: { users: { data: { id: 'u-victim', school_id: 'school-a' }, error: null }, audit_logs: { data: null, error: null } },
      writes,
    }));
    await ctrl.logFailedLogin({ email: 'Victim@School.test' }, { ip: '203.0.113.7' });
    const inserts = writes.filter(([t, op]) => t === 'audit_logs' && op === 'insert');
    expect(inserts).toHaveLength(1);
    expect(inserts[0]![2]).toMatchObject({ user_id: null, school_id: null, entity_id: null, metadata: { email: 'victim@school.test', client_reported: true } });
  });

  it('ignores non-email input', async () => {
    const writes: Array<[string, string, unknown]> = [];
    const ctrl = new AuthController(fakeSupabase({ me: null, writes }));
    await ctrl.logFailedLogin({ email: { $ne: 1 } }, { ip: '203.0.113.8' });
    await ctrl.logFailedLogin({ email: 'not-an-email' }, { ip: '203.0.113.8' });
    expect(writes).toHaveLength(0);
  });

  it('caps reports per IP per minute', () => {
    const now = 1_000_000;
    const results = Array.from({ length: 12 }, () => allowFailedLoginReport('198.51.100.1', now));
    expect(results.filter(Boolean)).toHaveLength(10);
    expect(allowFailedLoginReport('198.51.100.1', now + 60_000)).toBe(true);
  });
});

// ── SA-45: report-card link is built server-side; teachers are scoped ───────
describe('NotificationsService.sendReportCardEmail (SA-45)', () => {
  const at = {} as AfricasTalkingClient;
  const config = fakeConfig({ NEXT_PUBLIC_APP_URL: 'https://app.skuli.test/' });

  it('links only to the school report card page, never a caller-supplied URL', async () => {
    const writes: Array<[string, string, unknown]> = [];
    const svc = new NotificationsService(fakeSupabase({
      me: null,
      admin: {
        users: { data: { id: 'u-admin', role: 'ADMIN', school_id: 'school-a' }, error: null },
        students: { data: { school_id: 'school-a', current_class_id: 'c1', user: [{ full_name: 'S' }] }, error: null },
        terms: { data: { id: 'term-1', school_id: 'school-a' }, error: null },
        guardians: { data: [{ user: [{ id: 'u-g', full_name: 'G', email: 'g@x.test' }] }], error: null },
      },
      writes,
    }), config, at);
    const queue = jest.spyOn(svc, 'queue').mockResolvedValue(undefined as never);
    jest.spyOn(svc as unknown as { sendEmail: () => Promise<void> }, 'sendEmail').mockResolvedValue(undefined);
    await svc.sendReportCardEmail('auth-admin', 'stu-1', 'term-1');
    const sent = queue.mock.calls[0]![0][0] as unknown as { body: string; metadata: { reportCardUrl: string } };
    expect(sent.metadata.reportCardUrl).toBe('https://app.skuli.test/print/report-card/stu-1?termId=term-1');
    expect(sent.body).toContain('https://app.skuli.test/print/report-card/stu-1');
  });

  it('refuses a teacher who is not the student\'s class teacher', async () => {
    const svc = new NotificationsService(fakeSupabase({
      me: null,
      admin: {
        users: { data: { id: 'u-t', role: 'TEACHER', school_id: 'school-a' }, error: null },
        students: { data: { school_id: 'school-a', current_class_id: 'c2', user: [] }, error: null },
        teachers: { data: { is_class_teacher_of: 'c1' }, error: null },
      },
    }), config, at);
    await expect(svc.sendReportCardEmail('auth-t', 'stu-1', 'term-1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses a term from another school', async () => {
    const svc = new NotificationsService(fakeSupabase({
      me: null,
      admin: {
        users: { data: { id: 'u-admin', role: 'ADMIN', school_id: 'school-a' }, error: null },
        students: { data: { school_id: 'school-a', current_class_id: 'c1', user: [] }, error: null },
        terms: { data: { id: 'term-x', school_id: 'school-b' }, error: null },
      },
    }), config, at);
    await expect(svc.sendReportCardEmail('auth-admin', 'stu-1', 'term-x')).rejects.toBeInstanceOf(NotFoundException);
  });
});
