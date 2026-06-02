import { createClient } from '@/lib/supabase/server';
import BackButton from '@/components/BackButton';
import Link from 'next/link';
import EmailReportCardButton from './EmailReportCardButton';

export default async function AdminReportCardsPage({
  searchParams,
}: {
  searchParams: { classId?: string; termId?: string };
}) {
  const supabase = createClient();

  const [{ data: classes }, { data: terms }] = await Promise.all([
    supabase.from('classes').select('id, name, grade_level').eq('is_active', true).order('grade_level').order('name'),
    supabase.from('terms').select('id, name, is_current').order('start_date', { ascending: false }),
  ]);

  const classId = searchParams.classId ?? (classes ?? [])[0]?.id ?? '';
  const termId = searchParams.termId ?? (terms ?? []).find((t) => t.is_current)?.id ?? (terms ?? [])[0]?.id ?? '';

  const { data: students } = classId
    ? await supabase
        .from('students')
        .select('id, admission_no, user:users!user_id(full_name)')
        .eq('current_class_id', classId)
        .eq('is_active', true)
        .order('id')
    : { data: [] };

  const studentIds = (students ?? []).map((s) => s.id);
  const { data: reportCards } = studentIds.length && termId
    ? await supabase
        .from('student_report_cards')
        .select('student_id, is_published, class_teacher_comment, head_teacher_comment')
        .in('student_id', studentIds)
        .eq('term_id', termId)
    : { data: [] };

  const rcMap = Object.fromEntries((reportCards ?? []).map((r) => [r.student_id, r]));
  const publishedCount = (reportCards ?? []).filter((r) => r.is_published).length;
  const commentedCount = (reportCards ?? []).filter((r) => r.class_teacher_comment).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <BackButton href="/admin" />
        <div>
          <h1 className="text-2xl font-semibold">Report cards</h1>
          <p className="text-sm text-slate-500 mt-0.5">Generate and publish end-of-term report cards.</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap bg-white border border-slate-200 rounded-xl p-4">
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">Class</label>
          <div className="flex gap-2 flex-wrap">
            {(classes ?? []).map((c) => (
              <a key={c.id} href={`/admin/report-cards?classId=${c.id}&termId=${termId}`}
                className={`text-sm px-3 py-1 rounded-full font-medium transition-colors ${c.id === classId ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                {c.name}
              </a>
            ))}
          </div>
        </div>
        <div className="ml-auto">
          <label className="block text-xs font-medium text-slate-500 mb-1">Term</label>
          <div className="flex gap-2 flex-wrap">
            {(terms ?? []).map((t) => (
              <a key={t.id} href={`/admin/report-cards?classId=${classId}&termId=${t.id}`}
                className={`text-sm px-3 py-1 rounded-full font-medium transition-colors ${t.id === termId ? 'bg-violet-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                {t.name}
              </a>
            ))}
          </div>
        </div>
      </div>

      {/* Stats */}
      {(students ?? []).length > 0 && (
        <div className="flex gap-4">
          <div className="bg-white border border-slate-100 rounded-xl px-5 py-3 text-center">
            <p className="text-2xl font-bold">{(students ?? []).length}</p>
            <p className="text-xs text-slate-400">Students</p>
          </div>
          <div className="bg-white border border-slate-100 rounded-xl px-5 py-3 text-center">
            <p className="text-2xl font-bold text-amber-600">{commentedCount}</p>
            <p className="text-xs text-slate-400">With comments</p>
          </div>
          <div className="bg-white border border-slate-100 rounded-xl px-5 py-3 text-center">
            <p className="text-2xl font-bold text-emerald-600">{publishedCount}</p>
            <p className="text-xs text-slate-400">Published</p>
          </div>
        </div>
      )}

      {/* Student list */}
      {(students ?? []).length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-white p-10 text-center text-sm text-slate-400">
          Select a class above.
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          {(students ?? []).map((s, i) => {
            const rc = rcMap[(s as any).id];
            return (
              <div key={(s as any).id} className={`flex items-center gap-4 px-5 py-3 ${i > 0 ? 'border-t border-slate-100' : ''}`}>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-slate-800">{((s as any).user as any)?.full_name}</p>
                  <p className="text-xs text-slate-400">{(s as any).admission_no}</p>
                </div>
                <div className="flex items-center gap-2">
                  {rc?.is_published ? (
                    <span className="text-xs bg-emerald-100 text-emerald-700 font-medium px-2 py-0.5 rounded-full">Published</span>
                  ) : rc?.class_teacher_comment ? (
                    <span className="text-xs bg-amber-100 text-amber-700 font-medium px-2 py-0.5 rounded-full">Draft</span>
                  ) : (
                    <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">No comment</span>
                  )}
                  <Link
                    href={`/print/report-card/${(s as any).id}?termId=${termId}`}
                    target="_blank"
                    className="text-xs border border-slate-200 px-3 py-1 rounded-lg hover:bg-slate-50 text-slate-600"
                  >
                    View
                  </Link>
                  <Link
                    href={`/print/report-card/${(s as any).id}?termId=${termId}&edit=1`}
                    target="_blank"
                    className="text-xs bg-slate-900 text-white px-3 py-1 rounded-lg hover:bg-slate-700"
                  >
                    Edit
                  </Link>
                  {rc?.is_published && (
                    <EmailReportCardButton
                      studentId={(s as any).id}
                      termId={termId ?? ''}
                      reportCardUrl={`${process.env.NEXT_PUBLIC_APP_URL ?? ''}/print/report-card/${(s as any).id}?termId=${termId}`}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
