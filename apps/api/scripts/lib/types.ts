// Shared entity shapes threaded between seed-*.ts modules. Deliberately
// minimal — only the fields later modules actually need to reference, not a
// full mirror of each table's schema (that lives in the audit doc).

export interface SeededSchool {
  id: string;
  name: string;
  slug: string;
}

export interface SeededTerm {
  id: string;
  name: string;
  startDate: string; // YYYY-MM-DD
  endDate: string;
}

export interface SeededClass {
  id: string;
  name: string; // e.g. "Grade 6B"
  gradeLevel: number; // 1-8
  stream: 'A' | 'B';
}

export interface SeededSubject {
  id: string;
  name: string;
  code: string;
}

export interface SeededSubjectAssignment {
  id: string;
  classId: string;
  subjectId: string;
  teacherId: string; // teachers.id
}

export interface SeededDepartment {
  id: string;
  name: string;
}

export interface SeededTeacher {
  teacherId: string; // teachers.id
  userId: string; // users.id
  authId: string;
  fullName: string;
  email: string;
  isClassTeacherOf: string | null; // classes.id, set later
}

export interface SeededStudent {
  studentId: string; // students.id
  userId: string; // users.id
  authId: string;
  fullName: string;
  gender: 'MALE' | 'FEMALE';
  admissionNo: string;
  classId: string;
  className: string;
  gradeLevel: number;
  stream: 'A' | 'B';
  rosterIndex: number; // 0-based position within their class
}

export interface SeededParent {
  userId: string;
  authId: string;
  fullName: string;
  email: string;
  studentIds: string[]; // their linked children
}

export interface SeededGuardianLink {
  id: string;
  userId: string; // parent's users.id
  studentId: string;
}
