import { createClient } from '@/lib/supabase/server';
import BackButton from '@/components/BackButton';
import Link from 'next/link';
import UserAvatar from '@/components/UserAvatar';

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return new Date(iso).toLocaleDateString('en-KE', { day: 'numeric', month: 'short' });
}

export default async function AdminMessagesPage({
  searchParams,
}: {
  searchParams: { filter?: string };
}) {
  const supabase = createClient();
  const flaggedOnly = searchParams.filter === 'flagged';

  let query = supabase
    .from('conversations')
    .select(`
      id, last_message_body, last_message_at, is_flagged, created_at,
      parent:users!parent_user_id(id, full_name, avatar_url),
      teacher:users!teacher_user_id(id, full_name, avatar_url),
      student:students(id, user:users!user_id(full_name))
    `)
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(100);

  if (flaggedOnly) query = query.eq('is_flagged', true);

  const { data: conversations } = await query;

  const total = conversations?.length ?? 0;
  const flaggedCount = (conversations ?? []).filter((c) => c.is_flagged).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <BackButton href="/admin" />
        <div>
          <h1 className="text-2xl font-semibold">Messages oversight</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {total} conversation{total !== 1 ? 's' : ''}
            {flaggedCount > 0 && ` · ${flaggedCount} flagged`}
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-2">
        <Link
          href="/admin/messages"
          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            !flaggedOnly ? 'bg-slate-900 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
          }`}
        >
          All
        </Link>
        <Link
          href="/admin/messages?filter=flagged"
          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            flaggedOnly ? 'bg-rose-600 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
          }`}
        >
          ⚑ Flagged {flaggedCount > 0 && `(${flaggedCount})`}
        </Link>
      </div>

      {(conversations ?? []).length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-white p-10 text-center text-sm text-slate-400">
          {flaggedOnly ? 'No flagged conversations.' : 'No conversations yet.'}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          {(conversations ?? []).map((c, i) => {
            const parent = c.parent as { id: string; full_name: string; avatar_url?: string | null };
            const teacher = c.teacher as { id: string; full_name: string; avatar_url?: string | null };
            const studentName = c.student
              ? ((c.student as any)?.user?.full_name as string | undefined)
              : null;

            return (
              <Link
                key={c.id}
                href={`/admin/messages/${c.id}`}
                className={`flex items-center gap-4 px-5 py-4 hover:bg-slate-50 transition-colors ${
                  i > 0 ? 'border-t border-slate-100' : ''
                }`}
              >
                <div className="flex -space-x-2 shrink-0">
                  <UserAvatar name={parent?.full_name ?? '?'} avatarUrl={parent?.avatar_url} size={32} />
                  <UserAvatar name={teacher?.full_name ?? '?'} avatarUrl={teacher?.avatar_url} size={32} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="text-sm font-medium text-slate-800">{parent?.full_name ?? '—'}</span>
                    <span className="text-xs text-slate-400">→</span>
                    <span className="text-sm font-medium text-slate-800">{teacher?.full_name ?? '—'}</span>
                    {studentName && (
                      <span className="text-xs text-slate-500">re: {studentName}</span>
                    )}
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5 truncate">
                    {c.last_message_body ?? 'No messages'}
                  </p>
                </div>
                <div className="shrink-0 flex items-center gap-2">
                  {c.is_flagged && (
                    <span className="text-xs bg-rose-100 text-rose-600 font-medium px-2 py-0.5 rounded-full">⚑</span>
                  )}
                  {c.last_message_at && (
                    <span className="text-xs text-slate-400">{timeAgo(c.last_message_at)}</span>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
