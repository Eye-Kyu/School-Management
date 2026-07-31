/**
 * Unit tests for the BUG-6 read-state cascade — verifies each function
 * builds the exact filter/payload it should, using a small call-recording
 * fake client (distinct from notifications-aggregation.service.spec.ts's
 * FakeQueryBuilder, since this needs to assert *which* filters were applied,
 * not just return canned data).
 */

import {
  cascadeConversationReadToNotifications,
  cascadeNotificationReadToConversation,
} from '../messaging/message-read-cascade';

type Call = { method: string; args: unknown[] };

function makeRecordingClient() {
  const calls: Call[] = [];
  const builder = {
    update: (...args: unknown[]) => { calls.push({ method: 'update', args }); return builder; },
    eq: (...args: unknown[]) => { calls.push({ method: 'eq', args }); return builder; },
    gt: (...args: unknown[]) => { calls.push({ method: 'gt', args }); return Promise.resolve({ data: null, error: null }); },
    then: (resolve: (v: { data: null; error: null }) => unknown) => resolve({ data: null, error: null }),
  };
  const client = {
    from: (table: string) => { calls.push({ method: 'from', args: [table] }); return builder; },
  };
  return { client: client as never, calls };
}

describe('cascadeConversationReadToNotifications', () => {
  it('updates notifications, scoped to NEW_MESSAGE, this recipient, this conversation, unread only', async () => {
    const { client, calls } = makeRecordingClient();
    await cascadeConversationReadToNotifications(client, 'conv-1', 'user-1');

    expect(calls[0]).toEqual({ method: 'from', args: ['notifications'] });
    expect(calls).toContainEqual({ method: 'update', args: [{ is_read: true }] });
    expect(calls).toContainEqual({ method: 'eq', args: ['type', 'NEW_MESSAGE'] });
    expect(calls).toContainEqual({ method: 'eq', args: ['recipient_id', 'user-1'] });
    expect(calls).toContainEqual({ method: 'eq', args: ['metadata->>conversationId', 'conv-1'] });
    expect(calls).toContainEqual({ method: 'eq', args: ['is_read', false] });
  });

  it('never touches the conversations table', async () => {
    const { client, calls } = makeRecordingClient();
    await cascadeConversationReadToNotifications(client, 'conv-1', 'user-1');
    expect(calls.some((c) => c.method === 'from' && c.args[0] === 'conversations')).toBe(false);
  });
});

describe('cascadeNotificationReadToConversation', () => {
  it.each([
    ['PARENT', 'parent_unread_count'],
    ['TEACHER', 'teacher_unread_count'],
    ['ADMIN', 'admin_unread_count'],
  ])('zeroes %s\'s own unread column, scoped to this conversation and already-unread', async (role, column) => {
    const { client, calls } = makeRecordingClient();
    await cascadeNotificationReadToConversation(client, 'conv-1', role);

    expect(calls[0]).toEqual({ method: 'from', args: ['conversations'] });
    expect(calls).toContainEqual({ method: 'update', args: [{ [column]: 0 }] });
    expect(calls).toContainEqual({ method: 'eq', args: ['id', 'conv-1'] });
    expect(calls).toContainEqual({ method: 'gt', args: [column, 0] });
  });

  it('is a no-op for a role with no conversation participation (e.g. STUDENT)', async () => {
    const { client, calls } = makeRecordingClient();
    await cascadeNotificationReadToConversation(client, 'conv-1', 'STUDENT');
    expect(calls).toEqual([]);
  });

  it('never touches the notifications table', async () => {
    const { client, calls } = makeRecordingClient();
    await cascadeNotificationReadToConversation(client, 'conv-1', 'PARENT');
    expect(calls.some((c) => c.method === 'from' && c.args[0] === 'notifications')).toBe(false);
  });
});
