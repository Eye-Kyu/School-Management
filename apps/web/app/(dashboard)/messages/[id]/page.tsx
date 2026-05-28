import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import BackButton from '@/components/BackButton';
import UserAvatar from '@/components/UserAvatar';
import ThreadClient from './ThreadClient';

export default async function ThreadPage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: userRow } = await supabase
    .from('users')
    .select('id, role')
    .eq('auth_id', user.id)
    .maybeSingle();
  if (!userRow) redirect('/login');

  const { data: conv } = await supabase
    .from('conversations')
    .select(`
      id, is_flagged,
      parent:users!parent_user_id(id, full_name, avatar_url),
      teacher:users!teacher_user_id(id, full_name, avatar_url),
      student:students(id, user:users!user_id(full_name))
    `)
    .eq('id', params.id)
    .maybeSingle();

  if (!conv) redirect('/messages');

  const { data: messages } = await supabase
    .from('messages')
    .select('id, sender_id, body, is_flagged, read_at, created_at')
    .eq('conversation_id', params.id)
    .order('created_at', { ascending: true })
    .limit(200);

  const parent = conv.parent as unknown as { id: string; full_name: string; avatar_url?: string | null };
  const teacher = conv.teacher as unknown as { id: string; full_name: string; avatar_url?: string | null };
  const otherParty = userRow.role === 'PARENT' ? teacher : parent;

  const studentName = conv.student
    ? ((conv.student as any)?.user?.full_name as string | undefined)
    : null;

  return (
    <div className="flex flex-col max-w-2xl h-[calc(100vh-3.5rem)]">
      {/* Header */}
      <div className="flex items-center gap-3 pb-4 border-b border-slate-200 shrink-0">
        <BackButton href="/messages" />
        <UserAvatar name={otherParty?.full_name ?? '?'} avatarUrl={otherParty?.avatar_url} size={36} />
        <div className="min-w-0">
          <p className="font-semibold text-slate-800 truncate">{otherParty?.full_name ?? 'Unknown'}</p>
          {studentName && (
            <p className="text-xs text-slate-400">re: {studentName}</p>
          )}
        </div>
        {conv.is_flagged && (
          <span className="ml-auto text-xs bg-rose-100 text-rose-600 font-medium px-2 py-0.5 rounded-full">⚑ flagged</span>
        )}
      </div>

      <ThreadClient
        conversationId={params.id}
        initialMessages={(messages ?? []) as any[]}
        currentUserId={userRow.id}
        otherParty={otherParty ?? { id: '', full_name: 'Unknown' }}
      />
    </div>
  );
}
