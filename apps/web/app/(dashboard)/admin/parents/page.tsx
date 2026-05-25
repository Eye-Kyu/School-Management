import BackButton from '@/components/BackButton';
import { createClient } from '@/lib/supabase/server';
import ParentsClient from './ParentsClient';

export default async function ParentsPage() {
  const supabase = createClient();

  const [{ data: guardianRows }, { data: students }] = await Promise.all([
    supabase
      .from('guardians')
      .select(`
        id, relationship,
        parent:users!inner(id, full_name, email, phone),
        student:students!inner(id, admission_no, user:users!inner(full_name))
      `)
      .order('created_at'),
    supabase
      .from('students')
      .select('id, admission_no, user:users!inner(full_name)')
      .eq('is_active', true)
      .order('admission_no'),
  ]);

  // Group guardian rows by parent user so each parent appears once with all children
  const parentMap = new Map<string, any>();
  for (const row of guardianRows ?? []) {
    const parent = (row as any).parent;
    if (!parentMap.has(parent.id)) {
      parentMap.set(parent.id, {
        userId: parent.id,
        fullName: parent.full_name,
        email: parent.email,
        phone: parent.phone,
        children: [],
      });
    }
    const student = (row as any).student;
    parentMap.get(parent.id).children.push({
      admissionNo: student.admission_no,
      studentName: student.user.full_name,
      relationship: row.relationship,
    });
  }
  const parents = Array.from(parentMap.values());

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <BackButton href="/admin" />
        <div>
          <h1 className="text-2xl font-semibold">Parents</h1>
          <p className="text-sm text-slate-500 mt-0.5">{parents.length} parent accounts</p>
        </div>
      </div>
      <ParentsClient initialParents={parents} students={(students ?? []) as any} />
    </div>
  );
}
