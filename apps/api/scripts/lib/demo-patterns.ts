// =============================================================================
// Deterministic demo-case bookkeeping — Refinement 3 (Phase 2 review).
// =============================================================================
// Centralizes "which student/class/assignment is the demo case" so it's
// computed once, in one place, and every other seed-*.ts module (and
// eventually docs/sample-school-demo-patterns.md) reads from here rather
// than re-deriving indices independently. All identification is by
// deterministic index/admission-number, matching the review's own examples
// — never by name lookup (names are RNG output, indices are structural).
// =============================================================================

import type { SeededClass, SeededStudent, SeededSubjectAssignment, SeededSubject } from './types';

export interface DemoPatterns {
  decliningStudent: SeededStudent; // Grade 6B, admission #GRADE6B003
  starStudent: SeededStudent; // Grade 8A, roster index 0, admission #GRADE8A001
  approvedAbsenceStudent: SeededStudent; // distinct from the above two
  arrearsStudent: SeededStudent; // Grade 8A, distinct roster slot
  siblingParentStudents: [SeededStudent, SeededStudent] | null; // filled in once guardians exist
  linkedHomeworkAssignment: SeededSubjectAssignment; // Grade 5, Mathematics
  linkedQuizAssignment: SeededSubjectAssignment; // Grade 7, Science and Technology
}

/** Finds a class by exact "Grade{level}{stream}" name — throws if not found,
 * since every demo case depends on this class genuinely existing. */
function findClass(classes: SeededClass[], gradeLevel: number, stream: 'A' | 'B'): SeededClass {
  const cls = classes.find((c) => c.gradeLevel === gradeLevel && c.stream === stream);
  if (!cls) throw new Error(`Demo pattern setup: Grade ${gradeLevel}${stream} not found among seeded classes`);
  return cls;
}

function findStudent(students: SeededStudent[], admissionNo: string): SeededStudent {
  const student = students.find((s) => s.admissionNo === admissionNo);
  if (!student) throw new Error(`Demo pattern setup: student ${admissionNo} not found`);
  return student;
}

export function resolveDemoPatterns(
  classes: SeededClass[],
  students: SeededStudent[],
  subjectAssignments: SeededSubjectAssignment[],
  subjects: SeededSubject[],
): DemoPatterns {
  const decliningStudent = findStudent(students, 'GRADE6B003');
  const starStudent = findStudent(students, 'GRADE8A001');
  // A third, distinct student for the approved-absences showcase — Grade 4A, roster index 8 (admission #GRADE4A009).
  const approvedAbsenceStudent = findStudent(students, 'GRADE4A009');
  // A fourth, distinct student for the fee-arrears showcase — Grade 8A, roster index 1 (admission #GRADE8A002) —
  // deliberately NOT index 0 (that's the star student, who is fully paid).
  const arrearsStudent = findStudent(students, 'GRADE8A002');

  const grade5A = findClass(classes, 5, 'A');
  const grade7A = findClass(classes, 7, 'A');
  const mathSubject = subjects.find((s) => s.code === 'MATH')!;
  const sciSubject = subjects.find((s) => s.code === 'SCITECH')!;

  const linkedHomeworkAssignment = subjectAssignments.find((a) => a.classId === grade5A.id && a.subjectId === mathSubject.id);
  const linkedQuizAssignment = subjectAssignments.find((a) => a.classId === grade7A.id && a.subjectId === sciSubject.id);
  if (!linkedHomeworkAssignment) throw new Error('Demo pattern setup: Grade 5A Mathematics subject_assignment not found');
  if (!linkedQuizAssignment) throw new Error('Demo pattern setup: Grade 7A Science and Technology subject_assignment not found');

  return {
    decliningStudent, starStudent, approvedAbsenceStudent, arrearsStudent,
    siblingParentStudents: null, // resolved later, once guardian links exist (see resolveSiblingDemoCase)
    linkedHomeworkAssignment, linkedQuizAssignment,
  };
}

/** The sibling-parent demo case is a byproduct of seed-people.ts's guardian
 * assignment algorithm (20 deliberate sibling pairs, student i <-> i+200) —
 * resolved here by picking the first such pair, once guardian links exist. */
export function resolveSiblingDemoCase(students: SeededStudent[]): [SeededStudent, SeededStudent] {
  const first = students[0];
  const partner = students[200];
  if (!first || !partner) throw new Error('Demo pattern setup: expected at least 201 students for the sibling-pair demo case');
  return [first, partner];
}
