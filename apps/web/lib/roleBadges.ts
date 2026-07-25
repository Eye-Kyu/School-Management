import type { BadgeVariant } from '@school-manager/ui';

export type RoleBadge = { variant: BadgeVariant; label: string; href?: string };

// Resolves the small set of role badges a user has earned beyond their base
// role — Class Teacher, Department Head, Class Prefect, School Prefect.
// Subject-teacher-of-record is deliberately never badged here (too noisy,
// per the spec). Used by both the profile page and each role's dashboard so
// the two stay in sync automatically.
export async function getMyRoleBadges(
  supabase: ReturnType<typeof import('@/lib/supabase/server').createClient>,
  userId: string,
  role: string,
): Promise<RoleBadge[]> {
  const badges: RoleBadge[] = [];

  if (role === 'TEACHER') {
    const { data: teacher } = await supabase
      .from('teachers')
      .select('id, is_class_teacher_of, department_id')
      .eq('user_id', userId)
      .maybeSingle();

    if (teacher?.is_class_teacher_of) {
      const { data: cls } = await supabase.from('classes').select('name').eq('id', teacher.is_class_teacher_of).maybeSingle();
      if (cls) badges.push({ variant: 'classTeacher', label: `Class Teacher: ${cls.name}` });
    }

    const { data: headOf } = await supabase.from('departments').select('name').eq('department_head_user_id', userId).maybeSingle();
    if (headOf) badges.push({ variant: 'departmentHead', label: `Head of ${headOf.name} Department` });
  }

  if (role === 'STUDENT') {
    const { data: student } = await supabase.from('students').select('id').eq('user_id', userId).maybeSingle();
    if (student) {
      const { data: classPrefect } = await supabase
        .from('class_prefects')
        .select('class:classes!inner(name)')
        .eq('student_id', student.id)
        .is('revoked_at', null)
        .maybeSingle();
      const className = (classPrefect?.class as unknown as { name: string } | null)?.name;
      if (className) badges.push({ variant: 'classPrefect', label: `Class Prefect: ${className}`, href: '/prefect-role-info' });

      const { data: schoolPrefect } = await supabase
        .from('school_prefects')
        .select('role_title')
        .eq('student_id', student.id)
        .is('revoked_at', null)
        .maybeSingle();
      if (schoolPrefect) badges.push({ variant: 'schoolPrefect', label: schoolPrefect.role_title, href: '/prefect-role-info' });
    }
  }

  return badges;
}
