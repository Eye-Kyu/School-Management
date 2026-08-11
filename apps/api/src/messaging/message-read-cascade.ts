import type { SupabaseService } from '../supabase/supabase.service';

type Client = ReturnType<SupabaseService['forUser']>;

// =============================================================================
// Conversation <-> NEW_MESSAGE notification read-state cascade (BUG-6)
// =============================================================================
// A new message produces two independent "unread" signals: the conversation's
// own unread counter, and a NEW_MESSAGE row in `notifications` (kept — the
// unified feed needs it to show messages as feed items, Option B from the
// BUG-6 review). Neither used to affect the other. These two functions are
// the only places either direction is written.
//
// Each function touches exactly one table and never calls the other, and
// neither calls back into MessagingService.markRead() or
// NotificationsAggregationService.markRead() — there is no code path for a
// cascade to re-trigger a cascade, so there's nothing for a recursion guard
// to protect against by construction, not by a runtime flag.
//
// Both use the caller's RLS-scoped client (never the admin client), so a
// crafted/guessed id belonging to another user or school simply matches zero
// rows — no separate tenant check needs to be written here.
// =============================================================================

// Called only from MessagingService.markRead(), after it resets the
// conversation's own unread counter for the caller.
export async function cascadeConversationReadToNotifications(
  client: Client,
  conversationId: string,
  userId: string,
): Promise<void> {
  await client
    .from('notifications')
    .update({ is_read: true })
    .eq('type', 'NEW_MESSAGE')
    .eq('recipient_id', userId)
    .eq('metadata->>conversationId', conversationId)
    .eq('is_read', false);
}

const UNREAD_COLUMN: Record<string, string> = {
  PARENT: 'parent_unread_count',
  TEACHER: 'teacher_unread_count',
  ADMIN: 'admin_unread_count',
};

// Called only from NotificationsAggregationService.markRead(), once per
// distinct conversation id among the NEW_MESSAGE rows just marked read.
// STUDENT (and any other role with no unread column) is a no-op — matches
// the same role gating buildConversations() already uses.
export async function cascadeNotificationReadToConversation(
  client: Client,
  conversationId: string,
  role: string,
): Promise<void> {
  const column = UNREAD_COLUMN[role];
  if (!column) return;

  await client
    .from('conversations')
    .update({ [column]: 0 })
    .eq('id', conversationId)
    .gt(column, 0);
}
