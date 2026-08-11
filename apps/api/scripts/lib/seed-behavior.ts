// =============================================================================
// Behavior: behaviour_points (British spelling — the real table name),
// class_prefects (needed for realistic incident-report reporters), and
// behavior_incident_reports (American spelling — confirmed inconsistent,
// both spellings are correct as written here).
// =============================================================================

import { randomUUID } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { SeedLogger } from './seed-logger';
import { batchInsert } from './db-utils';
import { weekdaysInRange } from './dates';
import type { SeededTerm, SeededStudent, SeededTeacher, SeededClass } from './types';
import type { DemoPatterns } from './demo-patterns';
import type { Rng } from './kenyan-names';

const POSITIVE_REASONS = ['Helped a classmate', 'Excellent classroom participation', 'Showed leadership during group work', 'Kept the classroom tidy', 'Outstanding homework effort'];
const NEGATIVE_REASONS = ['Late to class repeatedly', 'Disruptive during lesson', 'Incomplete assignment without explanation', 'Unkind to a classmate'];
const REASON_CATEGORIES = ['academic', 'attendance', 'citizenship', 'leadership', 'other'] as const;

export async function seedClassPrefects(
  admin: SupabaseClient,
  logger: SeedLogger,
  schoolId: string,
  term: SeededTerm,
  classes: SeededClass[],
  studentsByClass: Map<string, SeededStudent[]>,
  adminUserId: string,
  rng: Rng,
): Promise<SeededStudent[]> {
  // One prefect for a handful of classes (demo variety only, not required
  // for data correctness) — picks the first 5 classes deterministically.
  const prefectClasses = classes.slice(0, 5);
  const prefects: SeededStudent[] = [];
  const rows = prefectClasses.map((cls) => {
    const roster = studentsByClass.get(cls.id) ?? [];
    const prefect = roster[Math.floor(rng() * roster.length)] ?? roster[0];
    if (!prefect) return null;
    prefects.push(prefect);
    return {
      id: randomUUID(), school_id: schoolId, class_id: cls.id, student_id: prefect.studentId,
      term_id: term.id, assigned_by_user_id: adminUserId,
    };
  }).filter((r): r is NonNullable<typeof r> => r !== null);

  await batchInsert(admin, logger, 'class_prefects', schoolId, rows);
  return prefects;
}

export async function seedBehaviourPoints(
  admin: SupabaseClient,
  logger: SeedLogger,
  schoolId: string,
  term: SeededTerm,
  students: SeededStudent[],
  classTeachers: SeededTeacher[],
  demo: DemoPatterns,
  rng: Rng,
): Promise<void> {
  const weekdays = weekdaysInRange(term.startDate, term.endDate);
  const teacherForClass = new Map(classTeachers.map((t) => [t.isClassTeacherOf, t]));
  const fallbackTeacher = classTeachers[0]!;

  const rows: Array<{
    id: string; school_id: string; student_id: string; teacher_id: string;
    category: string; points: number; reason: string; date: string; reason_category: string;
  }> = [];

  function addEntry(student: SeededStudent, category: 'POSITIVE' | 'NEGATIVE', date: string): void {
    const teacher = teacherForClass.get(student.classId) ?? fallbackTeacher;
    const reason = category === 'POSITIVE'
      ? POSITIVE_REASONS[Math.floor(rng() * POSITIVE_REASONS.length)]!
      : NEGATIVE_REASONS[Math.floor(rng() * NEGATIVE_REASONS.length)]!;
    rows.push({
      id: randomUUID(), school_id: schoolId, student_id: student.studentId, teacher_id: teacher.teacherId,
      category, points: 1 + Math.floor(rng() * 5), reason, date,
      reason_category: REASON_CATEGORIES[Math.floor(rng() * REASON_CATEGORIES.length)]!,
    });
  }

  // Declining student: 2 negative entries, deliberately in the second half of term.
  const secondHalfStart = Math.floor(weekdays.length / 2);
  addEntry(demo.decliningStudent, 'NEGATIVE', weekdays[secondHalfStart + 5]!);
  addEntry(demo.decliningStudent, 'NEGATIVE', weekdays[secondHalfStart + 15]!);

  // Star student: 4-5 positive, zero negative, spread across the term.
  const starEntryCount = 4 + Math.floor(rng() * 2);
  for (let i = 0; i < starEntryCount; i++) {
    addEntry(demo.starStudent, 'POSITIVE', weekdays[Math.floor((i + 1) * weekdays.length / (starEntryCount + 1))]!);
  }

  // General population, ~500 rows total (minus the ~7-9 already added above).
  const remaining = 500 - rows.length;
  const generalStudents = students.filter((s) => s.studentId !== demo.decliningStudent.studentId && s.studentId !== demo.starStudent.studentId);
  for (let i = 0; i < remaining; i++) {
    const student = generalStudents[Math.floor(rng() * generalStudents.length)]!;
    const category: 'POSITIVE' | 'NEGATIVE' = rng() < 0.6 ? 'POSITIVE' : 'NEGATIVE';
    const date = weekdays[Math.floor(rng() * weekdays.length)]!;
    addEntry(student, category, date);
  }

  await batchInsert(admin, logger, 'behaviour_points', schoolId, rows);
}

export async function seedBehaviorIncidentReports(
  admin: SupabaseClient,
  logger: SeedLogger,
  schoolId: string,
  term: SeededTerm,
  students: SeededStudent[],
  prefects: SeededStudent[],
  rng: Rng,
): Promise<void> {
  const weekdays = weekdaysInRange(term.startDate, term.endDate);
  const categories = ['Bullying', 'Property damage', 'Disruptive behavior', 'Dress code violation', 'Conflict with a peer'];
  const reportingPrefects = prefects.length > 0 ? prefects : students.slice(0, 1);

  // ~30 distinct students, ~50 reports total — some students get 2 reports.
  const targetStudents = [...students].sort(() => rng() - 0.5).slice(0, 30);
  const rows: Array<{
    id: string; school_id: string; reported_by_user_id: string; student_id: string;
    category: string; description: string; status: string; created_at: string;
  }> = [];

  for (let i = 0; i < 50; i++) {
    const student = targetStudents[i % targetStudents.length]!;
    const reporter = reportingPrefects[Math.floor(rng() * reportingPrefects.length)]!;
    const category = categories[Math.floor(rng() * categories.length)]!;
    const date = weekdays[Math.floor(rng() * weekdays.length)]!;
    rows.push({
      id: randomUUID(), school_id: schoolId, reported_by_user_id: reporter.userId, student_id: student.studentId,
      category, description: `${category} incident reported involving ${student.fullName.split(' ')[0]}.`,
      status: rng() < 0.7 ? 'REVIEWED' : 'PENDING', created_at: `${date}T10:00:00Z`,
    });
  }

  await batchInsert(admin, logger, 'behavior_incident_reports', schoolId, rows);
}
