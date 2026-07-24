import { createClient } from '@/lib/supabase/server';
import BackButton from '@/components/BackButton';
import PlatformMessagesClient from './PlatformMessagesClient';

export default async function PlatformMessagesPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: recipientRows } = await supabase
    .from('platform_message_recipients')
    .select('id, read_at, dismissed_at, message:platform_messages(subject, body, sent_at)')
    .order('id', { ascending: false });

  const rows = (recipientRows ?? [])
    .map((r: any) => ({
      recipientId: r.id as string,
      subject: r.message?.subject ?? '',
      body: r.message?.body ?? '',
      sentAt: r.message?.sent_at ?? '',
      readAt: r.read_at as string | null,
      dismissedAt: r.dismissed_at as string | null,
    }))
    .sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime());

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-4">
        <BackButton href="/notifications" />
        <div>
          <h1 className="text-2xl font-semibold">Platform Messages</h1>
          <p className="text-sm text-slate-500 mt-0.5">Announcements from the platform team.</p>
        </div>
      </div>
      <PlatformMessagesClient initialRows={rows} />
    </div>
  );
}
