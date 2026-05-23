// =============================================================================
// Seed script - creates a demo school with one admin user
// =============================================================================
// Run with: pnpm db:seed
// Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env
// Uses Supabase JS client for all DB writes (HTTPS, no direct Postgres needed).
// =============================================================================

import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

async function main() {
  console.log('Seeding database...\n');

  const supabase = createClient(
    requireEnv('SUPABASE_URL'),
    requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  // -- 1. Create a school -----------------------------------------------------
  const { data: existingSchool } = await supabase
    .from('schools')
    .select('id, name')
    .eq('slug', 'demo-primary')
    .maybeSingle();

  let school = existingSchool;
  if (!school) {
    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from('schools')
      .insert({
        id: randomUUID(),
        name: 'Demo Primary School',
        slug: 'demo-primary',
        phone: '+254700000000',
        email: 'office@demo.school',
        timezone: 'Africa/Nairobi',
        updated_at: now,
      })
      .select('id, name')
      .single();
    if (error) throw new Error(`Failed to create school: ${error.message}`);
    school = data;
    console.log(`  School:  ${school.name}  (${school.id})`);
  } else {
    console.log(`  School:  ${school.name}  (${school.id}) — already exists`);
  }

  // -- 2. Create an admin auth user (Supabase Auth) ---------------------------
  const adminEmail = 'admin@demo.school';
  const adminPassword = 'ChangeMe123!';

  const { data: existingUsers } = await supabase.auth.admin.listUsers();
  let authUser = existingUsers?.users.find((u) => u.email === adminEmail);

  if (!authUser) {
    const { data, error } = await supabase.auth.admin.createUser({
      email: adminEmail,
      password: adminPassword,
      email_confirm: true,
    });
    if (error) throw new Error(`Failed to create auth user: ${error.message}`);
    authUser = data.user;
    console.log(`  Auth:    created auth user ${adminEmail}`);
  } else {
    console.log(`  Auth:    auth user ${adminEmail} already exists`);
  }

  // -- 3. Mirror row in public.users ------------------------------------------
  const { data: existingUser } = await supabase
    .from('users')
    .select('id, full_name')
    .eq('auth_id', authUser.id)
    .maybeSingle();

  if (!existingUser) {
    const { data, error } = await supabase
      .from('users')
      .insert({
        id: randomUUID(),
        school_id: school.id,
        auth_id: authUser.id,
        email: adminEmail,
        full_name: 'School Admin',
        role: 'ADMIN',
        updated_at: new Date().toISOString(),
      })
      .select('id, full_name')
      .single();
    if (error) throw new Error(`Failed to create user row: ${error.message}`);
    console.log(`  Admin:   ${data.full_name}  (login: ${adminEmail} / ${adminPassword})`);
  } else {
    console.log(`  Admin:   ${existingUser.full_name}  — already exists`);
  }

  // -- 4. Create the current term ---------------------------------------------
  const { data: existingTerm } = await supabase
    .from('terms')
    .select('id, name, is_current')
    .eq('school_id', school.id)
    .eq('name', 'Term 1 2026')
    .maybeSingle();

  let term = existingTerm;
  if (!term) {
    const { data, error } = await supabase
      .from('terms')
      .insert({
        id: randomUUID(),
        school_id: school.id,
        name: 'Term 1 2026',
        start_date: '2026-01-06',
        end_date: '2026-04-10',
        is_current: true,
      })
      .select('id, name, is_current')
      .single();
    if (error) throw new Error(`Failed to create term: ${error.message}`);
    term = data;
    console.log(`  Term:    ${term.name}  (current: ${term.is_current})`);
  } else {
    console.log(`  Term:    ${term.name}  — already exists`);
  }

  // -- 5. Create a class (Grade 5 Blue) --------------------------------------
  const { data: existingClass } = await supabase
    .from('classes')
    .select('id, name')
    .eq('school_id', school.id)
    .eq('name', 'Grade 5 Blue')
    .maybeSingle();

  let cls = existingClass;
  if (!cls) {
    const { data, error } = await supabase
      .from('classes')
      .insert({
        id: randomUUID(),
        school_id: school.id,
        name: 'Grade 5 Blue',
        grade_level: 5,
        stream: 'Blue',
        updated_at: new Date().toISOString(),
      })
      .select('id, name')
      .single();
    if (error) throw new Error(`Failed to create class: ${error.message}`);
    cls = data;
    console.log(`  Class:   ${cls.name}  (${cls.id})`);
  } else {
    console.log(`  Class:   ${cls.name}  — already exists`);
  }

  // -- 6. Create a subject (Mathematics) ------------------------------------
  const { data: existingSubject } = await supabase
    .from('subjects')
    .select('id, name')
    .eq('school_id', school.id)
    .eq('code', 'MATH')
    .maybeSingle();

  let subject = existingSubject;
  if (!subject) {
    const { data, error } = await supabase
      .from('subjects')
      .insert({
        id: randomUUID(),
        school_id: school.id,
        name: 'Mathematics',
        code: 'MATH',
        updated_at: new Date().toISOString(),
      })
      .select('id, name')
      .single();
    if (error) throw new Error(`Failed to create subject: ${error.message}`);
    subject = data;
    console.log(`  Subject: ${subject.name}  (${subject.id})`);
  } else {
    console.log(`  Subject: ${subject.name}  — already exists`);
  }

  // -- 7. Create a teacher ---------------------------------------------------
  const teacherEmail = 'teacher@demo.school';
  const teacherPassword = 'Teacher123!';

  let teacherAuthUser = existingUsers?.users.find((u) => u.email === teacherEmail);
  if (!teacherAuthUser) {
    const { data, error } = await supabase.auth.admin.createUser({
      email: teacherEmail,
      password: teacherPassword,
      email_confirm: true,
    });
    if (error) throw new Error(`Failed to create teacher auth user: ${error.message}`);
    teacherAuthUser = data.user;
    console.log(`  Auth:    created auth user ${teacherEmail}`);
  } else {
    console.log(`  Auth:    auth user ${teacherEmail} already exists`);
  }

  const { data: existingTeacherUser } = await supabase
    .from('users')
    .select('id')
    .eq('auth_id', teacherAuthUser.id)
    .maybeSingle();

  let teacherUserId: string;
  if (!existingTeacherUser) {
    teacherUserId = randomUUID();
    const { error } = await supabase.from('users').insert({
      id: teacherUserId,
      school_id: school.id,
      auth_id: teacherAuthUser.id,
      email: teacherEmail,
      full_name: 'Jane Mwangi',
      role: 'TEACHER',
      updated_at: new Date().toISOString(),
    });
    if (error) throw new Error(`Failed to create teacher user row: ${error.message}`);
  } else {
    teacherUserId = existingTeacherUser.id;
  }

  const { data: existingTeacher } = await supabase
    .from('teachers')
    .select('id')
    .eq('user_id', teacherUserId)
    .maybeSingle();

  let teacherId: string;
  if (!existingTeacher) {
    teacherId = randomUUID();
    const { error } = await supabase.from('teachers').insert({
      id: teacherId,
      school_id: school.id,
      user_id: teacherUserId,
      staff_no: 'T001',
      updated_at: new Date().toISOString(),
    });
    if (error) throw new Error(`Failed to create teacher profile: ${error.message}`);
    console.log(`  Teacher: Jane Mwangi  (login: ${teacherEmail} / ${teacherPassword})`);
  } else {
    teacherId = existingTeacher.id;
    console.log(`  Teacher: Jane Mwangi  — already exists`);
  }

  // -- 8. Create a student ---------------------------------------------------
  const studentEmail = 'student@demo.school';
  const studentPassword = 'Student123!';

  let studentAuthUser = existingUsers?.users.find((u) => u.email === studentEmail);
  if (!studentAuthUser) {
    const { data, error } = await supabase.auth.admin.createUser({
      email: studentEmail,
      password: studentPassword,
      email_confirm: true,
    });
    if (error) throw new Error(`Failed to create student auth user: ${error.message}`);
    studentAuthUser = data.user;
    console.log(`  Auth:    created auth user ${studentEmail}`);
  } else {
    console.log(`  Auth:    auth user ${studentEmail} already exists`);
  }

  const { data: existingStudentUser } = await supabase
    .from('users')
    .select('id')
    .eq('auth_id', studentAuthUser.id)
    .maybeSingle();

  let studentUserId: string;
  if (!existingStudentUser) {
    studentUserId = randomUUID();
    const { error } = await supabase.from('users').insert({
      id: studentUserId,
      school_id: school.id,
      auth_id: studentAuthUser.id,
      email: studentEmail,
      full_name: 'Test Student 001',
      role: 'STUDENT',
      updated_at: new Date().toISOString(),
    });
    if (error) throw new Error(`Failed to create student user row: ${error.message}`);
  } else {
    studentUserId = existingStudentUser.id;
  }

  const { data: existingStudent } = await supabase
    .from('students')
    .select('id')
    .eq('user_id', studentUserId)
    .maybeSingle();

  let studentId: string;
  if (!existingStudent) {
    studentId = randomUUID();
    const { error } = await supabase.from('students').insert({
      id: studentId,
      school_id: school.id,
      user_id: studentUserId,
      admission_no: 'ADM001',
      current_class_id: cls.id,
      enrollment_date: '2026-01-06',
      updated_at: new Date().toISOString(),
    });
    if (error) throw new Error(`Failed to create student profile: ${error.message}`);
    console.log(`  Student: Test Student 001  (login: ${studentEmail} / ${studentPassword})`);
  } else {
    studentId = existingStudent.id;
    console.log(`  Student: Test Student 001  — already exists`);
  }

  // -- 9. Create a parent ----------------------------------------------------
  const parentEmail = 'parent@demo.school';
  const parentPassword = 'Parent123!';

  let parentAuthUser = existingUsers?.users.find((u) => u.email === parentEmail);
  if (!parentAuthUser) {
    const { data, error } = await supabase.auth.admin.createUser({
      email: parentEmail,
      password: parentPassword,
      email_confirm: true,
    });
    if (error) throw new Error(`Failed to create parent auth user: ${error.message}`);
    parentAuthUser = data.user;
    console.log(`  Auth:    created auth user ${parentEmail}`);
  } else {
    console.log(`  Auth:    auth user ${parentEmail} already exists`);
  }

  const { data: existingParentUser } = await supabase
    .from('users')
    .select('id')
    .eq('auth_id', parentAuthUser.id)
    .maybeSingle();

  let parentUserId: string;
  if (!existingParentUser) {
    parentUserId = randomUUID();
    const { error } = await supabase.from('users').insert({
      id: parentUserId,
      school_id: school.id,
      auth_id: parentAuthUser.id,
      email: parentEmail,
      full_name: 'Test Parent 001',
      role: 'PARENT',
      updated_at: new Date().toISOString(),
    });
    if (error) throw new Error(`Failed to create parent user row: ${error.message}`);
    console.log(`  Parent:  Test Parent 001  (login: ${parentEmail} / ${parentPassword})`);
  } else {
    parentUserId = existingParentUser.id;
    console.log(`  Parent:  Test Parent 001  — already exists`);
  }

  // -- 10. Link parent → student via guardians --------------------------------
  const { data: existingGuardian } = await supabase
    .from('guardians')
    .select('id')
    .eq('user_id', parentUserId)
    .eq('student_id', studentId)
    .maybeSingle();

  if (!existingGuardian) {
    const { error } = await supabase.from('guardians').insert({
      id: randomUUID(),
      user_id: parentUserId,
      student_id: studentId,
      relationship: 'Parent',
      is_primary: true,
    });
    if (error) throw new Error(`Failed to create guardian link: ${error.message}`);
    console.log(`  Guardian link: Test Parent 001 → Test Student 001`);
  } else {
    console.log(`  Guardian link: already exists`);
  }

  // -- 11. Create subject assignment (Jane → MATH → Grade 5 Blue) ------------
  const { data: existingAssignment } = await supabase
    .from('subject_assignments')
    .select('id')
    .eq('class_id', cls.id)
    .eq('subject_id', subject.id)
    .eq('teacher_id', teacherId)
    .maybeSingle();

  if (!existingAssignment) {
    const { error } = await supabase.from('subject_assignments').insert({
      id: randomUUID(),
      class_id: cls.id,
      subject_id: subject.id,
      teacher_id: teacherId,
    });
    if (error) throw new Error(`Failed to create subject assignment: ${error.message}`);
    console.log(`  Assignment: Jane Mwangi → Mathematics → Grade 5 Blue`);
  } else {
    console.log(`  Assignment: already exists`);
  }

  console.log('\n=== Demo credentials ===');
  console.log(`  Admin:   admin@demo.school   / ChangeMe123!`);
  console.log(`  Teacher: teacher@demo.school / Teacher123!`);
  console.log(`  Student: student@demo.school / Student123!`);
  console.log(`  Parent:  parent@demo.school  / Parent123!`);
  console.log('\nSeed complete.\n');
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
