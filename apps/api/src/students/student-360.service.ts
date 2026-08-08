import { Injectable, ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { SupabaseService } from '../supabase/supabase.service';
import { fetchAttendanceRateInputs, fetchStudentTermAverageInputs } from '../attendance/fetchers';
import { calculateAttendanceRate, calculateStudentTermAverage } from '@school-manager/types';
import { getCachedStudent360, setCachedStudent360 } from './student-360-cache';
import type { Student360View, Student360Data } from './student-360.types';

// =============================================================================
// Student 360 — read-only pastoral-care aggregation (Bucket 1, PR 4a)
// =============================================================================
// ADMIN + the student's own Class Teacher only (no Department Head, subject
// teacher, student, or parent access in this PR — see
// docs/audits/student-360-data-sources.md §1.8). Every view is audit-logged,
// unconditionally, cache hit or miss — the cache is keyed per (student,
// term), not per viewer, so it must never be allowed to skip the access
// check or the audit log, only the expensive aggregation step.
// =============================================================================

@Injectable()
export class Student360Service {
  constructor(private readonly supabase: SupabaseService) {}

  async getStudent360(accessToken: string, studentId: string): Promise<Student360View> {
    const userRow = (await this.supabase.currentUserRow(accessToken, 'id, role, school_id')) as
      { id: string; role: string; school_id: string } | null;
    if (!userRow) throw new NotFoundException('User not found');

    const { data: student } = await this.supabase.admin
      .from('students')
      .select('id, school_id, current_class_id, admission_no, user:users!inner(full_name), class:classes!current_class_id(name)')
      .eq('id', studentId)
      .maybeSingle();
    // Hides existence from a cross-tenant caller (404, not 403) — same
    // convention as AttendanceService.getApprovedAbsencesForStudent() /
    // MessagingService.markRead().
    if (!student || student.school_id !== userRow.school_id) {
      throw new NotFoundException('Student not found');
    }

    if (userRow.role === 'ADMIN') {
      // full access
    } else if (userRow.role === 'TEACHER') {
      const { data: teacherRow } = await this.supabase.admin
        .from('teachers').select('is_class_teacher_of').eq('user_id', userRow.id).maybeSingle();
      if (teacherRow?.is_class_teacher_of !== student.current_class_id) {
        // Covers subject-teacher-only and Department Head alike — neither
        // has a distinct code path, both simply aren't this student's Class
        // Teacher (Department Head access is deferred, no precedent exists
        // for the department -> subject -> class -> student join it needs).
        throw new ForbiddenException('You are not the class teacher of this student');
      }
    } else {
      throw new ForbiddenException("Not authorized to view this student's Student 360");
    }

    const { data: term } = await this.supabase.admin
      .from('terms')
      .select('id, name, start_date, end_date')
      .eq('school_id', userRow.school_id)
      .eq('is_current', true)
      .maybeSingle();
    if (!term) {
      throw new BadRequestException('No current term set for this school');
    }

    const cached = getCachedStudent360(studentId, term.id);
    let data: Student360Data;
    let aggregatedAt: string;
    if (cached) {
      data = cached.data;
      aggregatedAt = cached.aggregatedAt;
    } else {
      data = await this._aggregate(studentId, term, student);
      aggregatedAt = new Date().toISOString();
      setCachedStudent360(studentId, term.id, data, aggregatedAt);
    }

    // Audit log — unconditional, every view, cache hit or miss. Pastoral
    // records are sensitive; who looked at what matters regardless of
    // whether the data happened to already be warm.
    await this.supabase.admin.from('audit_logs').insert({
      id: randomUUID(),
      school_id: userRow.school_id,
      user_id: userRow.id,
      action: 'student.view_360',
      entity_type: 'student',
      entity_id: studentId,
      metadata: {
        target_student_id: studentId,
        viewer_id: userRow.id,
        viewer_role: userRow.role,
        viewed_at: new Date().toISOString(),
      },
    });

    return {
      ...data,
      metadata: {
        aggregated_at: aggregatedAt,
        viewer_id: userRow.id,
        viewer_role: userRow.role,
      },
    };
  }

  private async _aggregate(
    studentId: string,
    term: { id: string; name: string; start_date: string; end_date: string },
    student: { id: string; admission_no: string; user: unknown; class: unknown },
  ): Promise<Student360Data> {
    const [academic, attendance, behavior, incident_reports] = await Promise.all([
      this._aggregateAcademic(studentId, term),
      this._aggregateAttendance(studentId, term),
      this._aggregateBehavior(studentId, term),
      this._aggregateIncidentReports(studentId),
    ]);

    const studentUser = student.user as unknown as { full_name: string };
    const studentClass = student.class as unknown as { name: string } | null;

    return {
      student: {
        id: student.id,
        admission_no: student.admission_no,
        full_name: studentUser?.full_name ?? '',
        class_name: studentClass?.name ?? '',
        current_term: { id: term.id, name: term.name },
      },
      academic,
      attendance,
      behavior,
      incident_reports,
    };
  }

  private async _aggregateAcademic(
    studentId: string,
    term: { id: string; start_date: string; end_date: string },
  ): Promise<Student360Data['academic']> {
    const input = await fetchStudentTermAverageInputs(this.supabase.admin, { studentId, termId: term.id });
    const result = calculateStudentTermAverage(input);
    const struggling_subjects = result.by_subject
      .filter((s) => s.average_percentage < 50)
      .map((s) => ({ subject_id: s.subject_id, subject_name: s.subject_name, average_percentage: s.average_percentage }));

    // recent_grades needs assessment name/date, which the calculator's
    // input/output shapes deliberately don't carry (they're pure
    // calculation types, not display types) — a separate raw query.
    const { data: gradeRows } = await this.supabase.admin
      .from('grades')
      .select('score, graded_at, created_at, assessment:assessments!inner(name, max_marks, term_id, subject:subjects(name))')
      .eq('student_id', studentId)
      .eq('assessment.term_id', term.id)
      .not('score', 'is', null);

    const recent_grades = (gradeRows ?? [])
      .map((g) => {
        const assessment = g.assessment as unknown as { name: string; max_marks: number; subject: { name: string } | null };
        const score = Number(g.score);
        return {
          assessment_name: assessment.name,
          subject_name: assessment.subject?.name ?? '',
          score,
          max_marks: assessment.max_marks,
          percentage: assessment.max_marks > 0 ? (score / assessment.max_marks) * 100 : 0,
          graded_at: (g.graded_at ?? g.created_at) as string,
        };
      })
      .sort((a, b) => b.graded_at.localeCompare(a.graded_at))
      .slice(0, 5);

    return {
      overall_average_percentage: result.overall_average_percentage,
      assessment_count: result.assessment_count,
      by_subject: result.by_subject,
      struggling_subjects,
      recent_grades,
    };
  }

  private async _aggregateAttendance(
    studentId: string,
    term: { start_date: string; end_date: string },
  ): Promise<Student360Data['attendance']> {
    const input = await fetchAttendanceRateInputs(this.supabase.admin, this.supabase.admin, {
      studentIds: [studentId],
      startDate: term.start_date,
      endDate: term.end_date,
    });
    const result = calculateAttendanceRate(input);

    // recent_absences from the raw records/overlay the fetcher already
    // returned, mirroring calculateAttendanceRate()'s own per-day
    // classification (ABSENT+overlay -> approved, ABSENT alone ->
    // unapproved, EXCUSED -> approved, overlay-only-no-record -> approved).
    const approvedDates = new Set(input.approvedAbsences.map((a) => a.absence_date));
    const recordByDate = new Map(input.records.map((r) => [r.date, r.status]));
    const absenceEntries = new Map<string, boolean>(); // date -> approved
    for (const r of input.records) {
      if (r.status === 'ABSENT') absenceEntries.set(r.date, approvedDates.has(r.date));
      else if (r.status === 'EXCUSED') absenceEntries.set(r.date, true);
    }
    for (const date of approvedDates) {
      if (!recordByDate.has(date)) absenceEntries.set(date, true);
    }
    const recent_absences = Array.from(absenceEntries.entries())
      .sort(([a], [b]) => b.localeCompare(a))
      .slice(0, 5)
      .map(([date, approved]) => ({ date, approved }));

    return {
      attendance_rate: result.attendance_rate,
      present_days: result.present_days,
      tardy_count: result.tardy_count,
      approved_absences: result.approved_absences,
      unapproved_absences: result.unapproved_absences,
      total_school_days: result.total_school_days,
      recent_absences,
    };
  }

  private async _aggregateBehavior(
    studentId: string,
    term: { start_date: string; end_date: string },
  ): Promise<Student360Data['behavior']> {
    // behaviour_points' own SELECT RLS is blanket school-scope only (no
    // per-student narrowing at the DB layer) — this endpoint's own access
    // check above is what does that work here, matching BehaviourService's
    // established trust model for this exact table.
    const { data: rows } = await this.supabase.admin
      .from('behaviour_points')
      .select('points, category, reason_category, reason, date')
      .eq('student_id', studentId);

    let points_balance = 0;
    let positive_incidents_count = 0;
    let negative_incidents_count = 0;
    let incidents_this_term_count = 0;
    const all: Array<{ date: string; category: string; points_delta: number; description: string }> = [];

    for (const r of rows ?? []) {
      const points_delta = r.category === 'NEGATIVE' ? -r.points : r.points;
      points_balance += points_delta;
      if (points_delta > 0) positive_incidents_count++;
      else if (points_delta < 0) negative_incidents_count++;
      if (r.date >= term.start_date && r.date <= term.end_date) incidents_this_term_count++;
      all.push({ date: r.date, category: r.reason_category ?? 'uncategorized', points_delta, description: r.reason });
    }

    const recent_incidents = [...all].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);

    return {
      points_balance,
      positive_incidents_count,
      negative_incidents_count,
      incidents_this_term_count,
      recent_incidents,
    };
  }

  private async _aggregateIncidentReports(studentId: string): Promise<Student360Data['incident_reports']> {
    // Reporter identity shown plainly, per the locked-in decision — it's
    // already visible without masking in the existing teacher-facing view
    // (teacher/behavior-incidents), so this is not a novel privacy
    // restriction to introduce here. All-time: this table has no term field.
    const { data: rows } = await this.supabase.admin
      .from('behavior_incident_reports')
      .select('category, description, created_at, reported_by:users!reported_by_user_id(full_name)')
      .eq('student_id', studentId)
      .order('created_at', { ascending: false });

    const list = rows ?? [];
    const count_by_category: Record<string, number> = {};
    for (const r of list) count_by_category[r.category] = (count_by_category[r.category] ?? 0) + 1;

    const recent_reports = list.slice(0, 3).map((r) => {
      const reportedBy = r.reported_by as unknown as { full_name: string } | null;
      const description = r.description ?? '';
      return {
        date: r.created_at,
        category: r.category,
        reporter_name: reportedBy?.full_name ?? 'Unknown',
        brief_summary: description.length > 100 ? `${description.slice(0, 100)}…` : description,
      };
    });

    return {
      total_count: list.length,
      count_by_category,
      last_incident_date: list[0]?.created_at ?? null,
      recent_reports,
    };
  }
}
