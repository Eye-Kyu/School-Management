import { createClient } from '@/lib/supabase/server';
import BackButton from '@/components/BackButton';

type Assignment = {
  id: string;
  title: string;
  description: string | null;
  due_date: string;
  class: { name: string } | null;
  subject: { name: string } | null;
  completedAt: string | null;
  max_score: number | null;
  score: number | null;
  graderNote: string | null;
};

function isOverdue(dueDate: string, completedAt: string | null) {
  if (completedAt) return false;
  return new Date(dueDate) < new Date(new Date().toDateString());
}

export default async function ParentHomeworkPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // Find parent's user row → guardian rows → first child → child's class
  const { data: userRow } = await supabase
    .from('users').select('id').eq('auth_id', user?.id ?? '').maybeSingle();

  const { data: guardianRows } = userRow
    ? await supabase.from('guardians').select('student_id').eq('user_id', userRow.id)
    : { data: [] };

  const studentId = guardianRows?.[0]?.student_id ?? null;

  const { data: studentRow } = studentId
    ? await supabase.from('students').select('id, current_class_id').eq('id', studentId).maybeSingle()
    : { data: null };

  let assignments: Assignment[] = [];

  if (studentRow?.current_class_id) {
    const { data: hwRows } = await supabase
      .from('homework_assignments')
      .select('id, title, description, due_date, max_score, class:classes(name), subject:subjects(name), completions:homework_completions(student_id, completed_at, score, grader_note)')
      .eq('class_id', studentRow.current_class_id)
      .order('due_date', { ascending: true });

    assignments = (hwRows ?? []).map((hw: any) => {
      const match = hw.completions?.find((c: any) => c.student_id === studentRow.id);
      const { completions: _c, ...rest } = hw;
      return {
        ...rest,
        completedAt: match?.completed_at ?? null,
        score: match?.score ?? null,
        graderNote: match?.grader_note ?? null,
      };
    });
  }

  const pending = assignments.filter((a) => !a.completedAt);
  const done = assignments.filter((a) => a.completedAt);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <BackButton href="/parent" />
        <div>
          <h1 className="text-2xl font-semibold">Homework</h1>
          <p className="text-sm text-slate-500 mt-0.5">Your child&apos;s assigned homework and completion status.</p>
        </div>
      </div>

      {!studentRow && (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center text-slate-400 text-sm">
          No student linked to your account.
        </div>
      )}

      {studentRow && assignments.length === 0 && (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center text-slate-400 text-sm">
          No homework assigned right now.
        </div>
      )}

      {pending.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide">Pending ({pending.length})</h2>
          <div className="space-y-2">
            {pending.map((hw) => (
              <div
                key={hw.id}
                className={`rounded-lg border bg-white px-4 py-3 ${isOverdue(hw.due_date, hw.completedAt) ? 'border-red-200' : 'border-slate-200'}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-slate-800 text-sm">{hw.title}</span>
                      {hw.subject && (
                        <span className="text-xs bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">{hw.subject.name}</span>
                      )}
                    </div>
                    {hw.description && <p className="text-xs text-slate-500 mt-0.5">{hw.description}</p>}
                    <p className={`text-xs mt-0.5 ${isOverdue(hw.due_date, hw.completedAt) ? 'text-red-500 font-medium' : 'text-slate-400'}`}>
                      Due {new Date(hw.due_date).toLocaleDateString('en-KE', { weekday: 'short', day: 'numeric', month: 'short' })}
                      {isOverdue(hw.due_date, hw.completedAt) && ' — overdue'}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded font-medium">Pending</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {done.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide">Completed ({done.length})</h2>
          <div className="space-y-2">
            {done.map((hw) => (
              <div key={hw.id} className="rounded-lg border border-slate-200 bg-white px-4 py-3 opacity-70">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <span className="font-medium text-slate-600 text-sm line-through">{hw.title}</span>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Due {new Date(hw.due_date).toLocaleDateString('en-KE', { day: 'numeric', month: 'short' })}
                    </p>
                    {hw.graderNote && <p className="text-xs text-slate-500 mt-0.5">&quot;{hw.graderNote}&quot;</p>}
                  </div>
                  <div className="shrink-0 flex flex-col items-end gap-1">
                    <span className="text-xs bg-green-50 text-green-700 border border-green-200 px-2 py-0.5 rounded font-medium">✓ Done</span>
                    {hw.score != null && (
                      <span className="text-xs bg-violet-50 text-violet-700 border border-violet-200 px-2 py-0.5 rounded font-medium">
                        Score: {hw.score}{hw.max_score != null ? `/${hw.max_score}` : ''}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
