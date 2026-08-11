/**
 * Student360Service.getStudent360() — read-only pastoral-care aggregation
 * (Bucket 1, PR 4a). Supabase faked with a minimal per-table result queue,
 * matching the established pattern in homework.service.spec.ts /
 * attendance-approved-absences.service.spec.ts. No network required.
 *
 * Every test that reaches the aggregation step uses its OWN term id
 * (`termFixture(id)`) — student-360-cache.ts is a module-level singleton
 * that persists for the lifetime of this test file's process, exactly like
 * it does in production. Reusing the same (studentId, termId) pair across
 * tests would mean a later test silently reads an earlier test's cached
 * (and differently-shaped) aggregation instead of running its own —
 * discovered the hard way when a "composes all 4 sections" test kept
 * coming back empty because an earlier access-control test had already
 * cached an empty aggregation under the same key.
 */

import { ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { Student360Service } from '../students/student-360.service';
import type { SupabaseService } from '../supabase/supabase.service';

type TableResult = { data: unknown; error: unknown };

class FakeQueryBuilder implements PromiseLike<TableResult> {
  constructor(private readonly result: TableResult) {}
  select() { return this; }
  insert() { return this; }
  eq() { return this; }
  in() { return this; }
  gte() { return this; }
  lte() { return this; }
  not() { return this; }
  order() { return this; }
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

const STUDENT = {
  id: 'student-1', school_id: 'school-1', current_class_id: 'class-1', admission_no: 'ADM001',
  user: { full_name: 'Jane Doe' }, class: { name: 'Grade 5 Blue' },
};
const TERM = { id: 'term-1', name: 'Term 2 2026', start_date: '2026-05-01', end_date: '2026-08-01' };

// Distinct term id per test that reaches aggregation — see the file header
// comment for why this matters (the cache is a real module-level singleton).
function termFixture(id: string) {
  return { ...TERM, id };
}

// A full, empty-but-valid tail of queues for the 4 aggregation branches +
// the audit log insert — every test that reaches the aggregation step
// spreads this in and overrides only what it cares about.
function emptyAggregationQueues() {
  return {
    grades: [{ data: [], error: null }, { data: [], error: null }], // fetchStudentTermAverageInputs, then recent_grades
    homework_completions: [{ data: [], error: null }],
    quiz_attempts: [{ data: [], error: null }],
    attendance_records: [{ data: [], error: null }],
    absence_requests: [{ data: [], error: null }],
    behaviour_points: [{ data: [], error: null }],
    behavior_incident_reports: [{ data: [], error: null }],
    audit_logs: [{ data: null, error: null }],
  };
}

describe('Student360Service.getStudent360 — access control', () => {
  it('ADMIN, same school, is allowed', async () => {
    const supabase = makeFakeSupabase({
      userRow: { id: 'admin-1', role: 'ADMIN', school_id: 'school-1' },
      tableQueues: {
        students: [{ data: STUDENT, error: null }],
        terms: [{ data: termFixture('term-admin-ok'), error: null }],
        ...emptyAggregationQueues(),
      },
    });
    const svc = new Student360Service(supabase);
    const result = await svc.getStudent360('token', 'student-1');
    expect(result.student.full_name).toBe('Jane Doe');
    expect(result.metadata.viewer_role).toBe('ADMIN');
  });

  it("the student's own Class Teacher is allowed", async () => {
    const supabase = makeFakeSupabase({
      userRow: { id: 'teacher-1', role: 'TEACHER', school_id: 'school-1' },
      tableQueues: {
        students: [{ data: STUDENT, error: null }],
        teachers: [{ data: { is_class_teacher_of: 'class-1' }, error: null }],
        terms: [{ data: termFixture('term-teacher-ok'), error: null }],
        ...emptyAggregationQueues(),
      },
    });
    const svc = new Student360Service(supabase);
    const result = await svc.getStudent360('token', 'student-1');
    expect(result.student.id).toBe('student-1');
  });

  it("a Class Teacher of a DIFFERENT class is forbidden", async () => {
    const supabase = makeFakeSupabase({
      userRow: { id: 'teacher-2', role: 'TEACHER', school_id: 'school-1' },
      tableQueues: {
        students: [{ data: STUDENT, error: null }],
        teachers: [{ data: { is_class_teacher_of: 'some-other-class' }, error: null }],
      },
    });
    const svc = new Student360Service(supabase);
    await expect(svc.getStudent360('token', 'student-1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('a subject-teacher-only (no is_class_teacher_of match) is forbidden', async () => {
    const supabase = makeFakeSupabase({
      userRow: { id: 'teacher-3', role: 'TEACHER', school_id: 'school-1' },
      tableQueues: {
        students: [{ data: STUDENT, error: null }],
        teachers: [{ data: { is_class_teacher_of: null }, error: null }],
      },
    });
    const svc = new Student360Service(supabase);
    await expect(svc.getStudent360('token', 'student-1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('a Department Head (a TEACHER with no is_class_teacher_of match) is forbidden — no distinct code path, covered by the generic TEACHER check', async () => {
    const supabase = makeFakeSupabase({
      userRow: { id: 'dept-head-1', role: 'TEACHER', school_id: 'school-1' },
      tableQueues: {
        students: [{ data: STUDENT, error: null }],
        teachers: [{ data: { is_class_teacher_of: 'another-class' }, error: null }],
      },
    });
    const svc = new Student360Service(supabase);
    await expect(svc.getStudent360('token', 'student-1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('STUDENT is forbidden', async () => {
    const supabase = makeFakeSupabase({
      userRow: { id: 'student-user-1', role: 'STUDENT', school_id: 'school-1' },
      tableQueues: { students: [{ data: STUDENT, error: null }] },
    });
    const svc = new Student360Service(supabase);
    await expect(svc.getStudent360('token', 'student-1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('PARENT is forbidden', async () => {
    const supabase = makeFakeSupabase({
      userRow: { id: 'parent-1', role: 'PARENT', school_id: 'school-1' },
      tableQueues: { students: [{ data: STUDENT, error: null }] },
    });
    const svc = new Student360Service(supabase);
    await expect(svc.getStudent360('token', 'student-1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('a cross-tenant ADMIN gets 404, not 403 (hides existence, matching the approved-absences endpoint convention)', async () => {
    const supabase = makeFakeSupabase({
      userRow: { id: 'admin-school-b', role: 'ADMIN', school_id: 'school-B' },
      tableQueues: { students: [{ data: STUDENT, error: null }] }, // STUDENT belongs to school-1
    });
    const svc = new Student360Service(supabase);
    await expect(svc.getStudent360('token', 'student-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('a nonexistent student gets 404', async () => {
    const supabase = makeFakeSupabase({
      userRow: { id: 'admin-1', role: 'ADMIN', school_id: 'school-1' },
      tableQueues: { students: [{ data: null, error: null }] },
    });
    const svc = new Student360Service(supabase);
    await expect(svc.getStudent360('token', 'student-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('no current term set for the school throws BadRequestException', async () => {
    const supabase = makeFakeSupabase({
      userRow: { id: 'admin-1', role: 'ADMIN', school_id: 'school-1' },
      tableQueues: {
        students: [{ data: STUDENT, error: null }],
        terms: [{ data: null, error: null }],
      },
    });
    const svc = new Student360Service(supabase);
    await expect(svc.getStudent360('token', 'student-1')).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('Student360Service.getStudent360 — aggregation composition', () => {
  it('composes all 4 sections correctly for a populated fixture student', async () => {
    const supabase = makeFakeSupabase({
      userRow: { id: 'admin-1', role: 'ADMIN', school_id: 'school-1' },
      tableQueues: {
        students: [{ data: STUDENT, error: null }],
        terms: [{ data: termFixture('term-compose'), error: null }],
        grades: [
          {
            data: [
              { score: 18, source_type: 'DIRECT', source_id: null, assessment: { id: 'a1', subject_id: 'math', max_marks: 20, term_id: 'term-compose', subject: { name: 'Maths' } } },
              { score: 5, source_type: 'DIRECT', source_id: null, assessment: { id: 'a2', subject_id: 'eng', max_marks: 20, term_id: 'term-compose', subject: { name: 'English' } } },
            ],
            error: null,
          },
          {
            data: [
              { score: 18, graded_at: '2026-06-01T10:00:00Z', created_at: '2026-06-01T09:00:00Z', assessment: { name: 'CAT 1', max_marks: 20, subject: { name: 'Maths' } } },
              { score: 5, graded_at: '2026-06-05T10:00:00Z', created_at: '2026-06-05T09:00:00Z', assessment: { name: 'CAT 2', max_marks: 20, subject: { name: 'English' } } },
            ],
            error: null,
          },
        ],
        homework_completions: [{ data: [], error: null }],
        quiz_attempts: [{ data: [], error: null }],
        attendance_records: [{
          data: [
            { student_id: 'student-1', date: '2026-05-10', status: 'PRESENT' },
            { student_id: 'student-1', date: '2026-05-11', status: 'ABSENT' },
          ],
          error: null,
        }],
        absence_requests: [{ data: [], error: null }],
        behaviour_points: [{
          data: [
            { points: 5, category: 'POSITIVE', reason_category: 'citizenship', reason: 'Helped a classmate', date: '2026-05-15' },
            { points: 2, category: 'NEGATIVE', reason_category: null, reason: 'Late to class', date: '2026-05-16' },
          ],
          error: null,
        }],
        behavior_incident_reports: [{
          data: [
            { category: 'Bullying', description: 'A'.repeat(150), created_at: '2026-05-20T00:00:00Z', reported_by: { full_name: 'Mr. Smith' } },
          ],
          error: null,
        }],
        audit_logs: [{ data: null, error: null }],
      },
    });
    const svc = new Student360Service(supabase);
    const result = await svc.getStudent360('token', 'student-1');

    // Academic
    expect(result.academic.assessment_count).toBe(2);
    expect(result.academic.overall_average_percentage).toBeCloseTo((90 + 25) / 2, 5);
    expect(result.academic.struggling_subjects).toEqual([{ subject_id: 'eng', subject_name: 'English', average_percentage: 25 }]);
    expect(result.academic.recent_grades).toHaveLength(2);
    expect(result.academic.recent_grades[0]!.assessment_name).toBe('CAT 2'); // most recently graded first

    // Attendance
    expect(result.attendance.total_school_days).toBe(2);
    expect(result.attendance.present_days).toBe(1);
    expect(result.attendance.unapproved_absences).toBe(1);
    expect(result.attendance.recent_absences).toEqual([{ date: '2026-05-11', approved: false }]);

    // Behavior
    expect(result.behavior.points_balance).toBe(3); // +5 - 2
    expect(result.behavior.positive_incidents_count).toBe(1);
    expect(result.behavior.negative_incidents_count).toBe(1);
    expect(result.behavior.incidents_this_term_count).toBe(2);
    expect(result.behavior.recent_incidents[0]).toMatchObject({ category: 'uncategorized', points_delta: -2 }); // most recent (05-16) first

    // Incident reports
    expect(result.incident_reports.total_count).toBe(1);
    expect(result.incident_reports.count_by_category).toEqual({ Bullying: 1 });
    expect(result.incident_reports.last_incident_date).toBe('2026-05-20T00:00:00Z');
    expect(result.incident_reports.recent_reports[0]!.reporter_name).toBe('Mr. Smith');
    expect(result.incident_reports.recent_reports[0]!.brief_summary).toBe(`${'A'.repeat(100)}…`);

    expect(result.metadata.viewer_id).toBe('admin-1');
  });

  it('empty state: zero grades returns overall_average_percentage: null and empty by_subject', async () => {
    const supabase = makeFakeSupabase({
      userRow: { id: 'admin-1', role: 'ADMIN', school_id: 'school-1' },
      tableQueues: {
        students: [{ data: STUDENT, error: null }],
        terms: [{ data: termFixture('term-empty-grades'), error: null }],
        ...emptyAggregationQueues(),
      },
    });
    const svc = new Student360Service(supabase);
    const result = await svc.getStudent360('token', 'student-1');
    expect(result.academic).toMatchObject({
      overall_average_percentage: null, assessment_count: 0, by_subject: [], struggling_subjects: [], recent_grades: [],
    });
  });

  it('empty state: zero incidents/behavior returns empty arrays and zero counts, not null', async () => {
    const supabase = makeFakeSupabase({
      userRow: { id: 'admin-1', role: 'ADMIN', school_id: 'school-1' },
      tableQueues: {
        students: [{ data: STUDENT, error: null }],
        terms: [{ data: termFixture('term-empty-behavior'), error: null }],
        ...emptyAggregationQueues(),
      },
    });
    const svc = new Student360Service(supabase);
    const result = await svc.getStudent360('token', 'student-1');
    expect(result.behavior).toEqual({
      points_balance: 0, positive_incidents_count: 0, negative_incidents_count: 0, incidents_this_term_count: 0, recent_incidents: [],
    });
    expect(result.incident_reports).toEqual({
      total_count: 0, count_by_category: {}, last_incident_date: null, recent_reports: [],
    });
  });

  it('a subject at exactly 50% is NOT flagged struggling; 49.9% is', async () => {
    const supabase = makeFakeSupabase({
      userRow: { id: 'admin-1', role: 'ADMIN', school_id: 'school-1' },
      tableQueues: {
        students: [{ data: STUDENT, error: null }],
        terms: [{ data: termFixture('term-boundary-50'), error: null }],
        grades: [
          {
            data: [
              { score: 10, source_type: 'DIRECT', source_id: null, assessment: { id: 'a1', subject_id: 'exactly-50', max_marks: 20, term_id: 'term-boundary-50', subject: { name: 'Exactly50' } } },
              { score: 9.98, source_type: 'DIRECT', source_id: null, assessment: { id: 'a2', subject_id: 'below-50', max_marks: 20, term_id: 'term-boundary-50', subject: { name: 'Below50' } } },
            ],
            error: null,
          },
          { data: [], error: null },
        ],
        homework_completions: [{ data: [], error: null }],
        quiz_attempts: [{ data: [], error: null }],
        attendance_records: [{ data: [], error: null }],
        absence_requests: [{ data: [], error: null }],
        behaviour_points: [{ data: [], error: null }],
        behavior_incident_reports: [{ data: [], error: null }],
        audit_logs: [{ data: null, error: null }],
      },
    });
    const svc = new Student360Service(supabase);
    const result = await svc.getStudent360('token', 'student-1');
    const struggling = result.academic.struggling_subjects.map((s) => s.subject_id);
    expect(struggling).toContain('below-50');
    expect(struggling).not.toContain('exactly-50');
  });

  it('brief_summary truncates a description over 100 chars with an ellipsis and leaves a 100-char description untouched', async () => {
    const supabase = makeFakeSupabase({
      userRow: { id: 'admin-1', role: 'ADMIN', school_id: 'school-1' },
      tableQueues: {
        students: [{ data: STUDENT, error: null }],
        terms: [{ data: termFixture('term-brief-summary'), error: null }],
        ...emptyAggregationQueues(),
        behavior_incident_reports: [{
          data: [
            { category: 'A', description: 'X'.repeat(100), created_at: '2026-05-01T00:00:00Z', reported_by: { full_name: 'R1' } },
            { category: 'B', description: 'Y'.repeat(101), created_at: '2026-05-02T00:00:00Z', reported_by: { full_name: 'R2' } },
          ],
          error: null,
        }],
      },
    });
    const svc = new Student360Service(supabase);
    const result = await svc.getStudent360('token', 'student-1');
    const byCategory = Object.fromEntries(result.incident_reports.recent_reports.map((r) => [r.category, r.brief_summary]));
    expect(byCategory['A']).toBe('X'.repeat(100));
    expect(byCategory['B']).toBe(`${'Y'.repeat(100)}…`);
  });
});

describe('Student360Service.getStudent360 — caching', () => {
  it('a second call within TTL reuses the cached data (queue exhaustion proves no re-query) but still writes a fresh audit log for a different viewer', async () => {
    const supabase = makeFakeSupabase({
      userRow: { id: 'admin-1', role: 'ADMIN', school_id: 'school-1' },
      tableQueues: {
        // Two students/teachers/terms entries: one per call, since access
        // check + term resolution are NOT cached (only the 4 data sections are).
        students: [{ data: { ...STUDENT, id: 'cache-student-1' }, error: null }, { data: { ...STUDENT, id: 'cache-student-1' }, error: null }],
        terms: [{ data: { ...TERM, id: 'cache-term-1' }, error: null }, { data: { ...TERM, id: 'cache-term-1' }, error: null }],
        // Aggregation queues have exactly ONE entry each — a second
        // aggregation pass would get {data: null} and produce empty
        // results instead of the real fixture, so a mismatch proves a
        // stray re-query happened.
        grades: [{
          data: [{ score: 10, source_type: 'DIRECT', source_id: null, assessment: { id: 'a1', subject_id: 's1', max_marks: 20, term_id: 'cache-term-1', subject: { name: 'Sub' } } }],
          error: null,
        }, { data: [], error: null }],
        homework_completions: [{ data: [], error: null }],
        quiz_attempts: [{ data: [], error: null }],
        attendance_records: [{ data: [], error: null }],
        absence_requests: [{ data: [], error: null }],
        behaviour_points: [{ data: [], error: null }],
        behavior_incident_reports: [{ data: [], error: null }],
        audit_logs: [{ data: null, error: null }, { data: null, error: null }],
      },
    });
    const svc = new Student360Service(supabase);

    const first = await svc.getStudent360('token', 'cache-student-1');
    expect(first.academic.assessment_count).toBe(1); // real data, cache miss

    const secondSupabase = makeFakeSupabase({
      userRow: { id: 'teacher-viewer', role: 'TEACHER', school_id: 'school-1' },
      tableQueues: {
        students: [{ data: { ...STUDENT, id: 'cache-student-1' }, error: null }],
        teachers: [{ data: { is_class_teacher_of: 'class-1' }, error: null }],
        terms: [{ data: { ...TERM, id: 'cache-term-1' }, error: null }],
        audit_logs: [{ data: null, error: null }],
      },
    });
    const svc2 = new Student360Service(secondSupabase);
    const second = await svc2.getStudent360('token', 'cache-student-1');

    // Same underlying data (from cache, not a re-query against the
    // second fake's near-empty aggregation queues, which would have
    // produced assessment_count: 0 if the cache were bypassed).
    expect(second.academic.assessment_count).toBe(1);
    expect(second.academic).toEqual(first.academic);
    // aggregated_at reflects the first (real) computation, not "now" for viewer 2.
    expect(second.metadata.aggregated_at).toBe(first.metadata.aggregated_at);
    // metadata itself is always fresh per-viewer, never cached.
    expect(second.metadata.viewer_id).toBe('teacher-viewer');
    expect(second.metadata.viewer_role).toBe('TEACHER');
  });
});
