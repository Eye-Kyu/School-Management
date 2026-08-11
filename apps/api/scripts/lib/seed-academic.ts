// =============================================================================
// Academic + attendance: attendance_records, absence_requests, assessments,
// grades, homework_assignments/completions, quizzes/questions/attempts.
// =============================================================================

import { randomUUID } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeScore } from '@school-manager/types';
import type { SeedLogger } from './seed-logger';
import { batchInsert, writeLinkedGrade } from './db-utils';
import { weekdaysInRange } from './dates';
import type { SeededTerm, SeededStudent, SeededSubjectAssignment, SeededSubject, SeededGuardianLink } from './types';
import type { DemoPatterns } from './demo-patterns';
import type { Rng } from './kenyan-names';

function randomInRange(rng: Rng, min: number, max: number): number {
  return Math.round((min + rng() * (max - min)) * 100) / 100;
}

// -----------------------------------------------------------------------------
// Attendance + approved absences
// -----------------------------------------------------------------------------

type Window = [string, string]; // [startDate, endDate]

function planApprovedAbsenceWindows(rng: Rng, students: SeededStudent[], weekdays: string[], demo: DemoPatterns): Map<string, Window[]> {
  const windows = new Map<string, Window[]>();

  // Demo case: exactly 3 distinct, separated windows for one named student.
  windows.set(demo.approvedAbsenceStudent.studentId, [
    [weekdays[10]!, weekdays[10]!],
    [weekdays[25]!, weekdays[26]!],
    [weekdays[45]!, weekdays[45]!],
  ]);

  const excludeIds = new Set([
    demo.decliningStudent.studentId, demo.starStudent.studentId,
    demo.arrearsStudent.studentId, demo.approvedAbsenceStudent.studentId,
  ]);
  const eligible = students.filter((s) => !excludeIds.has(s.studentId));
  const shuffled = [...eligible].sort(() => rng() - 0.5);
  const chosen = shuffled.slice(0, 80); // ~80 students x ~2 days avg -> ~160 days, close to the audit's ~180 estimate

  for (const student of chosen) {
    const len = 1 + Math.floor(rng() * 3); // 1-3 consecutive days
    const startIdx = 5 + Math.floor(rng() * Math.max(1, weekdays.length - 10 - len));
    const start = weekdays[startIdx]!;
    const end = weekdays[Math.min(startIdx + len - 1, weekdays.length - 1)]!;
    windows.set(student.studentId, [[start, end]]);
  }
  return windows;
}

function isWithinWindows(date: string, windows: Window[] | undefined): boolean {
  if (!windows) return false;
  return windows.some(([start, end]) => date >= start && date <= end);
}

function attendanceStatusForDay(rng: Rng, student: SeededStudent, dayIndex: number, totalDays: number, demo: DemoPatterns): 'PRESENT' | 'LATE' | 'ABSENT' {
  if (student.studentId === demo.starStudent.studentId) {
    return rng() < 0.97 ? 'PRESENT' : 'LATE';
  }
  if (student.studentId === demo.decliningStudent.studentId) {
    const firstHalf = dayIndex < totalDays / 2;
    if (firstHalf) return rng() < 0.95 ? 'PRESENT' : 'LATE';
    if (rng() < 0.55) return 'ABSENT';
    return rng() < 0.85 ? 'PRESENT' : 'LATE';
  }
  const r = rng();
  if (r < 0.92) return 'PRESENT';
  if (r < 0.97) return 'LATE';
  return 'ABSENT';
}

export async function seedAttendanceAndAbsences(
  admin: SupabaseClient,
  logger: SeedLogger,
  schoolId: string,
  term: SeededTerm,
  students: SeededStudent[],
  guardianLinks: SeededGuardianLink[],
  adminUserId: string,
  markedByTeacherId: string,
  demo: DemoPatterns,
  rng: Rng,
): Promise<void> {
  const weekdays = weekdaysInRange(term.startDate, term.endDate);
  const approvedWindows = planApprovedAbsenceWindows(rng, students, weekdays, demo);
  const firstGuardianByStudent = new Map<string, string>();
  for (const link of guardianLinks) if (!firstGuardianByStudent.has(link.studentId)) firstGuardianByStudent.set(link.studentId, link.userId);

  const attendanceRows: Array<{ id: string; school_id: string; student_id: string; class_id: string; date: string; status: string; marked_by_id: string; updated_at: string }> = [];
  const absenceRequestRows: Array<{
    id: string; school_id: string; student_id: string; requested_by_user_id: string;
    start_date: string; end_date: string; reason: string; status: string;
    reviewed_by_user_id: string; reviewed_at: string;
  }> = [];

  const reasons = ['Family travel', 'Medical appointment', 'Family bereavement', 'Sick leave (doctor\'s note on file)'];
  let reasonIndex = 0;

  for (const student of students) {
    const windows = approvedWindows.get(student.studentId);
    if (windows) {
      for (const [start, end] of windows) {
        const requestedBy = firstGuardianByStudent.get(student.studentId) ?? adminUserId;
        absenceRequestRows.push({
          id: randomUUID(), school_id: schoolId, student_id: student.studentId, requested_by_user_id: requestedBy,
          start_date: start, end_date: end, reason: reasons[reasonIndex++ % reasons.length]!,
          status: 'APPROVED', reviewed_by_user_id: adminUserId, reviewed_at: `${start}T08:00:00Z`,
        });
      }
    }

    weekdays.forEach((date, dayIndex) => {
      if (isWithinWindows(date, windows)) return; // approved-absence overlay day — no attendance_records row, per the audit's §1.12 finding
      const status = attendanceStatusForDay(rng, student, dayIndex, weekdays.length, demo);
      attendanceRows.push({
        id: randomUUID(), school_id: schoolId, student_id: student.studentId, class_id: student.classId,
        date, status, marked_by_id: markedByTeacherId, updated_at: new Date().toISOString(),
      });
    });
  }

  await batchInsert(admin, logger, 'attendance_records', schoolId, attendanceRows);
  await batchInsert(admin, logger, 'absence_requests', schoolId, absenceRequestRows);
}

// -----------------------------------------------------------------------------
// Assessments + grades (DIRECT only — linked ones are created by the
// homework/quiz seeding functions below, as extra rows on top of these).
// -----------------------------------------------------------------------------

const ASSESSMENT_NAMES = ['CAT 1', 'CAT 2', 'Mid-term Exam', 'CAT 3', 'CAT 4', 'End-term Exam'];

function scoreForAssessment(rng: Rng, student: SeededStudent, subject: SeededSubject, assessmentIndex: number, demo: DemoPatterns): number {
  if (student.studentId === demo.decliningStudent.studentId && (subject.code === 'MATH' || subject.code === 'SCITECH')) {
    return assessmentIndex < 3 ? randomInRange(rng, 75, 85) : randomInRange(rng, 35, 50);
  }
  if (student.studentId === demo.starStudent.studentId) {
    return randomInRange(rng, 85, 98);
  }
  return randomInRange(rng, 45, 90);
}

export async function seedAssessmentsAndGrades(
  admin: SupabaseClient,
  logger: SeedLogger,
  schoolId: string,
  term: SeededTerm,
  subjectAssignments: SeededSubjectAssignment[],
  subjects: SeededSubject[],
  studentsByClass: Map<string, SeededStudent[]>,
  demo: DemoPatterns,
  rng: Rng,
): Promise<void> {
  const subjectById = new Map(subjects.map((s) => [s.id, s]));
  const assessmentDates = (() => {
    const days = weekdaysInRange(term.startDate, term.endDate);
    const step = Math.floor(days.length / 7);
    return ASSESSMENT_NAMES.map((_, i) => days[Math.min((i + 1) * step, days.length - 1)]!);
  })();

  const assessmentRows: Array<{ id: string; school_id: string; class_id: string; subject_id: string; term_id: string; teacher_id: string; name: string; max_marks: number; assessment_date: string }> = [];
  const gradeRows: Array<{ id: string; school_id: string; assessment_id: string; student_id: string; score: number; graded_at: string }> = [];

  for (const assignment of subjectAssignments) {
    const subject = subjectById.get(assignment.subjectId)!;
    const classStudents = studentsByClass.get(assignment.classId) ?? [];
    const assessmentIds: string[] = [];

    ASSESSMENT_NAMES.forEach((name, i) => {
      const id = randomUUID();
      assessmentIds.push(id);
      assessmentRows.push({
        id, school_id: schoolId, class_id: assignment.classId, subject_id: assignment.subjectId, term_id: term.id,
        teacher_id: assignment.teacherId, name, max_marks: 100, assessment_date: assessmentDates[i]!,
      });
    });

    assessmentIds.forEach((assessmentId, assessmentIndex) => {
      for (const student of classStudents) {
        const isDemoStudent = student.studentId === demo.decliningStudent.studentId || student.studentId === demo.starStudent.studentId;
        if (!isDemoStudent && rng() > 0.9) continue; // ~90% sit-rate; demo students always sit, so their pattern is always visible
        gradeRows.push({
          id: randomUUID(), school_id: schoolId, assessment_id: assessmentId, student_id: student.studentId,
          score: scoreForAssessment(rng, student, subject, assessmentIndex, demo), graded_at: `${assessmentDates[assessmentIndex]}T14:00:00Z`,
        });
      }
    });
  }

  await batchInsert(admin, logger, 'assessments', schoolId, assessmentRows);
  await batchInsert(admin, logger, 'grades', schoolId, gradeRows);
}

// -----------------------------------------------------------------------------
// Homework — ~250 assignments rotating through the 6 "core" subjects'
// class-subject pairings over 8 weeks; one specific Grade 5 Mathematics
// homework (week 4) is linked to the gradebook (the B1-2b demo showcase).
// -----------------------------------------------------------------------------

const CORE_SUBJECT_CODES_FOR_HOMEWORK = ['MATH', 'ENG', 'KISW', 'CRE', 'SCITECH', 'SOCST'];

export async function seedHomework(
  admin: SupabaseClient,
  logger: SeedLogger,
  schoolId: string,
  term: SeededTerm,
  subjectAssignments: SeededSubjectAssignment[],
  subjects: SeededSubject[],
  studentsByClass: Map<string, SeededStudent[]>,
  demo: DemoPatterns,
  rng: Rng,
): Promise<string[]> {
  const subjectById = new Map(subjects.map((s) => [s.id, s]));
  const coreAssignments = subjectAssignments.filter((a) => CORE_SUBJECT_CODES_FOR_HOMEWORK.includes(subjectById.get(a.subjectId)!.code));
  const weekStarts = Array.from({ length: 8 }, (_, w) => weekdaysInRange(term.startDate, term.endDate)[w * 5] ?? term.startDate);

  interface PlannedHomework { id: string; assignment: SeededSubjectAssignment; dueDate: string; isLinkedDemo: boolean }
  const planned: PlannedHomework[] = [];
  let round = 0;
  outer: while (planned.length < 250) {
    for (const assignment of coreAssignments) {
      if (planned.length >= 250) break outer;
      const isLinkedDemo = assignment.id === demo.linkedHomeworkAssignment.id && round === 1; // week-4-ish occurrence
      planned.push({ id: randomUUID(), assignment, dueDate: weekStarts[round % 8]!, isLinkedDemo });
    }
    round++;
  }

  const homeworkRows = planned.map((p, i) => ({
    id: p.id, school_id: schoolId, class_id: p.assignment.classId, subject_id: p.assignment.subjectId,
    teacher_id: p.assignment.teacherId, title: `${ASSESSMENT_NAMES[i % ASSESSMENT_NAMES.length]} Homework`,
    due_date: p.dueDate, max_score: 20, updated_at: new Date().toISOString(),
  }));
  await batchInsert(admin, logger, 'homework_assignments', schoolId, homeworkRows);

  const completionRows: Array<{ id: string; school_id: string; homework_id: string; student_id: string; completed_at: string; score: number | null; graded_at: string | null }> = [];
  const linkedDemoCompletions: Array<{ homeworkId: string; studentId: string; score: number }> = [];

  for (const p of planned) {
    const classStudents = studentsByClass.get(p.assignment.classId) ?? [];
    for (const student of classStudents) {
      if (rng() > 0.78) continue; // ~78% completion rate (task's 60-95% range, centered)
      const graded = rng() < 0.85;
      const score = graded ? randomInRange(rng, 8, 20) : null;
      completionRows.push({
        id: randomUUID(), school_id: schoolId, homework_id: p.id, student_id: student.studentId,
        completed_at: `${p.dueDate}T16:00:00Z`, score, graded_at: graded ? `${p.dueDate}T18:00:00Z` : null,
      });
      if (p.isLinkedDemo && graded && score !== null) linkedDemoCompletions.push({ homeworkId: p.id, studentId: student.studentId, score });
    }
  }
  await batchInsert(admin, logger, 'homework_completions', schoolId, completionRows);

  // Linked-homework demo case: create the linked assessment, then cascade
  // each graded completion's score via write_linked_grade() — never a raw
  // grades insert (grades_block_direct_edit_on_linked would reject it).
  const linkedPlan = planned.find((p) => p.isLinkedDemo);
  if (linkedPlan) {
    const assessmentId = randomUUID();
    const { error } = await admin.from('assessments').insert({
      id: assessmentId, school_id: schoolId, class_id: linkedPlan.assignment.classId, subject_id: linkedPlan.assignment.subjectId,
      term_id: term.id, teacher_id: linkedPlan.assignment.teacherId, name: 'Mathematics Homework (linked)',
      max_marks: 100, source_type: 'HOMEWORK', source_id: linkedPlan.id, assessment_date: linkedPlan.dueDate,
    });
    if (error) throw new Error(`Insert linked-homework assessment failed: ${error.message}`);
    logger.insert('assessments', 1, schoolId);

    for (const c of linkedDemoCompletions) {
      const normalized = normalizeScore(c.score, 20, 100);
      await writeLinkedGrade(admin, assessmentId, c.studentId, normalized);
    }
    logger.insert('grades (via write_linked_grade)', linkedDemoCompletions.length, schoolId);
  } else {
    logger.warn('Linked-homework demo case was not generated within the 250-homework budget — Grade 5A Mathematics may need more rotation rounds');
  }

  return planned.map((p) => p.id);
}

// -----------------------------------------------------------------------------
// Quizzes — 20 total, mostly upper-primary; one specific Grade 7 Science
// quiz is linked to the gradebook (the same showcase, for quizzes).
// -----------------------------------------------------------------------------

export async function seedQuizzes(
  admin: SupabaseClient,
  logger: SeedLogger,
  schoolId: string,
  term: SeededTerm,
  subjectAssignments: SeededSubjectAssignment[],
  subjects: SeededSubject[],
  studentsByClass: Map<string, SeededStudent[]>,
  adminUserId: string,
  demo: DemoPatterns,
  rng: Rng,
): Promise<string[]> {
  const subjectById = new Map(subjects.map((s) => [s.id, s]));
  const pool = subjectAssignments.filter((a) => {
    const subj = subjectById.get(a.subjectId)!;
    return ['MATH', 'SCITECH', 'SOCST', 'ENG'].includes(subj.code) && a.id !== demo.linkedQuizAssignment.id;
  });
  // The linked-quiz demo assignment always gets exactly one reserved slot
  // (index 0) — avoids any ambiguity about which generated quiz is "the"
  // linked one when picking which attempts to cascade below.
  const chosen: Array<{ assignment: SeededSubjectAssignment; isLinkedDemo: boolean }> = [
    { assignment: demo.linkedQuizAssignment, isLinkedDemo: true },
    ...pool.slice(0, 19).map((a) => ({ assignment: a, isLinkedDemo: false })),
  ];

  const quizRows: Array<{ id: string; school_id: string; class_id: string; subject_id: string; term_id: string; created_by_id: string; title: string; is_published: boolean }> = [];
  const questionRows: Array<{ id: string; quiz_id: string; school_id: string; position: number; kind: string; body: string; options: unknown; correct_option_id: string; points: number }> = [];
  const attemptRows: Array<{ id: string; school_id: string; quiz_id: string; student_id: string; started_at: string; submitted_at: string; score: number; max_score: number; answers: Record<string, unknown> }> = [];
  const linkedDemoAttempts: Array<{ studentId: string; score: number; maxScore: number }> = [];
  let linkedQuizId: string | undefined;

  chosen.forEach(({ assignment, isLinkedDemo }, quizIndex) => {
    const subject = subjectById.get(assignment.subjectId)!;
    const quizId = randomUUID();
    quizRows.push({
      id: quizId, school_id: schoolId, class_id: assignment.classId, subject_id: assignment.subjectId, term_id: term.id,
      created_by_id: adminUserId, title: `${subject.name} Quiz ${quizIndex + 1}`, is_published: true,
    });

    const questionCount = 5 + Math.floor(rng() * 4); // 5-8
    const points: number[] = [];
    for (let q = 0; q < questionCount; q++) {
      const questionPoints = 1;
      points.push(questionPoints);
      questionRows.push({
        id: randomUUID(), quiz_id: quizId, school_id: schoolId, position: q, kind: 'MCQ',
        body: `Sample question ${q + 1} for ${subject.name}`,
        options: [{ id: 'a', text: 'Option A' }, { id: 'b', text: 'Option B' }, { id: 'c', text: 'Option C' }],
        correct_option_id: 'a', points: questionPoints,
      });
    }
    const maxScore = points.reduce((a, b) => a + b, 0);

    const classStudents = studentsByClass.get(assignment.classId) ?? [];
    for (const student of classStudents) {
      if (rng() > 0.85) continue; // ~85% attempt rate
      const score = Math.round(randomInRange(rng, maxScore * 0.4, maxScore) );
      attemptRows.push({
        id: randomUUID(), school_id: schoolId, quiz_id: quizId, student_id: student.studentId,
        started_at: `${term.startDate}T09:00:00Z`, submitted_at: `${term.startDate}T09:20:00Z`,
        score, max_score: maxScore, answers: {},
      });
      if (isLinkedDemo) linkedDemoAttempts.push({ studentId: student.studentId, score, maxScore });
    }
    if (isLinkedDemo) linkedQuizId = quizId;
  });

  await batchInsert(admin, logger, 'quizzes', schoolId, quizRows);
  await batchInsert(admin, logger, 'quiz_questions', schoolId, questionRows);
  await batchInsert(admin, logger, 'quiz_attempts', schoolId, attemptRows);

  // Linked-quiz demo case: same pattern as the linked-homework case, but
  // replicating record_quiz_grade()'s own normalization formula inline
  // (ROUND((score/max_score) * assessment.max_marks, 2)) rather than
  // calling that RPC — it authorizes via current_user_id()/current_user_role(),
  // both of which resolve from auth.uid(), which is NULL under this
  // service-role session (no real JWT), so every call would hit its own
  // "Not authorized" branch. write_linked_grade() has no such check.
  if (linkedDemoAttempts.length > 0) {
    const linkedAssignment = demo.linkedQuizAssignment;
    const assessmentId = randomUUID();
    const { error } = await admin.from('assessments').insert({
      id: assessmentId, school_id: schoolId, class_id: linkedAssignment.classId, subject_id: linkedAssignment.subjectId,
      term_id: term.id, teacher_id: linkedAssignment.teacherId, name: 'Science and Technology Quiz (linked)',
      max_marks: 100, source_type: 'QUIZ', source_id: linkedQuizId, assessment_date: term.startDate,
    });
    if (error) throw new Error(`Insert linked-quiz assessment failed: ${error.message}`);
    logger.insert('assessments', 1, schoolId);

    for (const a of linkedDemoAttempts) {
      const normalized = Math.round((a.score / a.maxScore) * 100 * 100) / 100;
      await writeLinkedGrade(admin, assessmentId, a.studentId, normalized);
    }
    logger.insert('grades (via write_linked_grade)', linkedDemoAttempts.length, schoolId);
  } else {
    logger.warn('Linked-quiz demo case produced zero attempts — Grade 7A Science and Technology may need review');
  }

  return quizRows.map((q) => q.id);
}
