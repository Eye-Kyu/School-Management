import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import BackButton from '@/components/BackButton';
import UserAvatar from '@/components/UserAvatar';

export default async function AdminThreadPage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: conv } = await supabase
    .from('conversations')
    .select(`
      id, is_flagged, created_at,
      parent:users!parent_user_id(id, full_name, avatar_url),
      teacher:users!teacher_user_id(id, full_name, avatar_url),
      student:students(id, user:users!user_id(full_name))
    `)
    .eq('id', params.id)
    .maybeSingle();

  if (!conv) redirect('/admin/messages');

  const { data: messages } = await supabase
    .from('messages')
    .select('id, sender_id, body, is_flagged, read_at, created_at, sender:users!sender_id(full_name, avatar_url)')
    .eq('conversation_id', params.id)
    .order('created_at', { ascending: true })
    .limit(200);

  const parent = conv.parent as unknown as { id: string; full_name: string; avatar_url?: string | null };
  const teacher = conv.teacher as unknown as { id: string; full_name: string; avatar_url?: string | null };
  const studentName = conv.student ? ((conv.student as any)?.user?.full_name as string | undefined) : null;

  return (
    <div className="max-w-2xl space-y-4">
      <div className="flex items-center gap-3">
        <BackButton href="/admin/messages" />
        <div className="flex items-center gap-2">
          <UserAvatar name={parent?.full_name ?? '?'} avatarUrl={parent?.avatar_url} size={32} />
          <span className="text-sm text-slate-500">→</span>
          <UserAvatar name={teacher?.full_name ?? '?'} avatarUrl={teacher?.avatar_url} size={32} />
          <div>
            <p className="font-semibold text-slate-800 text-sm">
              {parent?.full_name} → {teacher?.full_name}
            </p>
            {studentName && <p className="text-xs text-slate-400">re: {studentName}</p>}
          </div>
        </div>
        {conv.is_flagged && (
          <span className="ml-auto text-xs bg-rose-100 text-rose-600 font-medium px-2 py-0.5 rounded-full">⚑ flagged</span>
        )}
      </div>

      {/* Read-only thread */}
      <div className="space-y-3">
        {(messages ?? []).map((msg) => {
          const sender = msg.sender as unknown as { full_name: string; avatar_url?: string | null };
          const isParent = msg.sender_id === (parent as { id: string }).id;
          return (
            <div key={msg.id} className={`flex items-end gap-2 ${isParent ? 'justify-start' : 'justify-end'}`}>
              {isParent && (
                <UserAvatar name={sender?.full_name ?? '?'} avatarUrl={sender?.avatar_url} size={26} />
              )}
              <div className="max-w-[75%]">
                <div
                  className={`rounded-2xl px-4 py-2.5 text-sm ${
                    isParent
                      ? 'bg-white border border-slate-200 text-slate-800 rounded-bl-sm'
                      : 'bg-slate-900 text-white rounded-br-sm'
                  } ${msg.is_flagged ? 'ring-2 ring-rose-400' : ''}`}
                >
                  {msg.body}
                  {msg.is_flagged && <span className="ml-2 text-xs text-rose-400">⚑</span>}
                </div>
                <p className={`text-[10px] mt-0.5 text-slate-400 ${isParent ? 'text-left' : 'text-right'}`}>
                  {sender?.full_name} ·{' '}
                  {new Date(msg.created_at).toLocaleString('en-KE', {
                    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true,
                  })}
                </p>
              </div>
              {!isParent && (
                <UserAvatar name={sender?.full_name ?? '?'} avatarUrl={sender?.avatar_url} size={26} />
              )}
            </div>
          );
        })}
      </div>

      <p className="text-center text-xs text-slate-400 pt-2 border-t border-slate-100">
        Admin view — read only
      </p>
    </div>
  );
}
