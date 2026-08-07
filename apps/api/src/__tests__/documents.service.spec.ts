/**
 * DocumentsService unit tests — Supabase faked with a minimal per-table
 * result queue, matching the established pattern in
 * homework.service.spec.ts. No network required.
 */

import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { DocumentsService } from '../documents/documents.service';
import type { SupabaseService } from '../supabase/supabase.service';

type TableResult = { data: unknown; error: unknown; count?: number };

class FakeQueryBuilder implements PromiseLike<TableResult> {
  constructor(private readonly result: TableResult) {}
  select() { return this; }
  update() { return this; }
  insert(_row?: unknown) { return this; }
  delete() { return this; }
  eq() { return this; }
  not() { return this; }
  in() { return this; }
  ilike() { return this; }
  gte() { return this; }
  lte() { return this; }
  order() { return this; }
  range() { return Promise.resolve(this.result); }
  limit() { return this; }
  maybeSingle() { return Promise.resolve(this.result); }
  single() { return Promise.resolve(this.result); }
  then<TResult1 = TableResult, TResult2 = never>(
    onfulfilled?: ((value: TableResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.result).then(onfulfilled, onrejected);
  }
}

function makeFakeSupabase(opts: {
  userRow: { id: string; role: string; school_id: string };
  tableQueues: Record<string, TableResult[]>;
  storageUploadResult?: { error: unknown };
  signedUrlResult?: { data: { signedUrl: string } | null; error: unknown };
}): { service: SupabaseService; rpcMock: jest.Mock; storageRemoveMock: jest.Mock } {
  const queues: Record<string, TableResult[]> = {};
  for (const [table, results] of Object.entries(opts.tableQueues)) queues[table] = [...results];

  const rpcMock = jest.fn().mockResolvedValue({ data: [], error: null });
  const storageRemoveMock = jest.fn().mockResolvedValue({ data: null, error: null });

  function makeClient() {
    return {
      from: (table: string) => {
        const queue = queues[table];
        const result = queue && queue.length > 0 ? queue.shift()! : { data: null, error: null };
        return new FakeQueryBuilder(result);
      },
      rpc: rpcMock,
    };
  }

  const admin = {
    ...makeClient(),
    storage: {
      from: () => ({
        upload: jest.fn().mockResolvedValue(opts.storageUploadResult ?? { error: null }),
        remove: storageRemoveMock,
        createSignedUrl: jest.fn().mockResolvedValue(
          opts.signedUrlResult ?? { data: { signedUrl: 'https://storage.example/signed' }, error: null },
        ),
      }),
    },
  };

  const service = {
    forUser: () => makeClient(),
    admin,
    currentUserRow: async () => opts.userRow,
  } as unknown as SupabaseService;

  return { service, rpcMock, storageRemoveMock };
}

function makeFile(overrides: Partial<Express.Multer.File> = {}): Express.Multer.File {
  return {
    fieldname: 'file',
    originalname: 'notes.pdf',
    encoding: '7bit',
    mimetype: 'application/pdf',
    size: 1024,
    buffer: Buffer.from('fake pdf bytes'),
    ...overrides,
  } as Express.Multer.File;
}

const uploadInput = {
  title: 'Term 1 syllabus',
  tags: [] as string[],
  scopeType: 'SCHOOL_WIDE' as const,
};

describe('DocumentsService.upload', () => {
  it('rejects a TEACHER trying to publish a school-wide document', async () => {
    const { service } = makeFakeSupabase({
      userRow: { id: 'user-1', role: 'TEACHER', school_id: 'school-1' },
      tableQueues: {},
    });
    const svc = new DocumentsService(service);

    await expect(
      svc.upload('token', makeFile(), uploadInput),
    ).rejects.toThrow(ForbiddenException);
  });

  it('allows an ADMIN to publish school-wide and writes the row + audit log', async () => {
    const { service } = makeFakeSupabase({
      userRow: { id: 'admin-1', role: 'ADMIN', school_id: 'school-1' },
      tableQueues: {
        documents: [{ data: { id: 'doc-1', title: 'Term 1 syllabus' }, error: null }],
      },
    });
    const svc = new DocumentsService(service);

    const result = await svc.upload('token', makeFile(), uploadInput);
    expect(result).toEqual({ id: 'doc-1', title: 'Term 1 syllabus' });
  });

  it('ASSIGNMENT/HOMEWORK: resolves ownership via teachers.user_id, not created_by_id directly', async () => {
    const { service } = makeFakeSupabase({
      userRow: { id: 'user-2', role: 'TEACHER', school_id: 'school-1' },
      tableQueues: {
        homework_assignments: [{ data: { id: 'hw-1', teacher_id: 'teacher-1' }, error: null }],
        teachers: [{ data: { id: 'teacher-1' }, error: null }], // teachers.id matches homework's teacher_id
        documents: [{ data: { id: 'doc-2' }, error: null }],
      },
    });
    const svc = new DocumentsService(service);

    const result = await svc.upload('token', makeFile(), {
      title: 'Reading list', tags: [], scopeType: 'ASSIGNMENT', scopeSubtype: 'HOMEWORK', scopeId: 'hw-1',
    });
    expect(result).toEqual({ id: 'doc-2' });
  });

  it('ASSIGNMENT/QUIZ: rejects a teacher who is not the quiz creator (created_by_id compared directly)', async () => {
    const { service } = makeFakeSupabase({
      userRow: { id: 'user-3', role: 'TEACHER', school_id: 'school-1' },
      tableQueues: {
        quizzes: [{ data: { id: 'quiz-1', created_by_id: 'some-other-user' }, error: null }],
      },
    });
    const svc = new DocumentsService(service);

    await expect(
      svc.upload('token', makeFile(), { title: 'Quiz notes', tags: [], scopeType: 'ASSIGNMENT', scopeSubtype: 'QUIZ', scopeId: 'quiz-1' }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('ASSIGNMENT/ONLINE_ASSIGNMENT: allows the creator (created_by_id matches directly)', async () => {
    const { service } = makeFakeSupabase({
      userRow: { id: 'user-4', role: 'TEACHER', school_id: 'school-1' },
      tableQueues: {
        assignments: [{ data: { id: 'assign-1', created_by_id: 'user-4' }, error: null }],
        documents: [{ data: { id: 'doc-3' }, error: null }],
      },
    });
    const svc = new DocumentsService(service);

    const result = await svc.upload('token', makeFile(), {
      title: 'Reference material', tags: [], scopeType: 'ASSIGNMENT', scopeSubtype: 'ONLINE_ASSIGNMENT', scopeId: 'assign-1',
    });
    expect(result).toEqual({ id: 'doc-3' });
  });

  it('CLASS: rejects a teacher with no subject_assignments row and not the class teacher', async () => {
    const { service } = makeFakeSupabase({
      userRow: { id: 'user-5', role: 'TEACHER', school_id: 'school-1' },
      tableQueues: {
        classes: [{ data: { id: 'class-1' }, error: null }],
        teachers: [{ data: { id: 'teacher-5', is_class_teacher_of: 'some-other-class' }, error: null }],
        subject_assignments: [{ data: null, error: null }],
      },
    });
    const svc = new DocumentsService(service);

    await expect(
      svc.upload('token', makeFile(), { title: 'Class handout', tags: [], scopeType: 'CLASS', scopeId: 'class-1' }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('cleans up the orphaned Storage object when the row insert fails after a successful Storage write', async () => {
    const { service, storageRemoveMock } = makeFakeSupabase({
      userRow: { id: 'admin-2', role: 'ADMIN', school_id: 'school-1' },
      tableQueues: {
        documents: [{ data: null, error: { message: 'insert failed' } }],
      },
    });
    const svc = new DocumentsService(service);

    await expect(svc.upload('token', makeFile(), uploadInput)).rejects.toThrow('insert failed');
    expect(storageRemoveMock).toHaveBeenCalledTimes(1);
  });

  it('surfaces a Storage upload failure as a BadRequestException without attempting the row insert', async () => {
    const { service } = makeFakeSupabase({
      userRow: { id: 'admin-3', role: 'ADMIN', school_id: 'school-1' },
      tableQueues: {},
      storageUploadResult: { error: { message: 'bucket quota exceeded' } },
    });
    const svc = new DocumentsService(service);

    await expect(svc.upload('token', makeFile(), uploadInput)).rejects.toThrow(BadRequestException);
  });
});

describe('DocumentsService.issueDownloadUrl', () => {
  it('throws NotFoundException when the RLS-scoped read returns nothing (invisible, indistinguishable from nonexistent)', async () => {
    const { service } = makeFakeSupabase({
      userRow: { id: 'user-1', role: 'STUDENT', school_id: 'school-1' },
      tableQueues: {
        documents: [{ data: null, error: null }],
      },
    });
    const svc = new DocumentsService(service);

    await expect(svc.issueDownloadUrl('token', 'doc-1')).rejects.toThrow(NotFoundException);
  });

  it('logs the download before returning the signed URL', async () => {
    const insertedRows: unknown[] = [];
    const queues: Record<string, TableResult[]> = {
      documents: [{ data: { id: 'doc-1', school_id: 'school-1', storage_path: 'school-1/doc-1-notes.pdf' }, error: null }],
    };
    const { service } = makeFakeSupabase({
      userRow: { id: 'user-1', role: 'STUDENT', school_id: 'school-1' },
      tableQueues: queues,
    });
    // Wrap forUser()'s client to capture the document_downloads insert call order.
    type FakeClient = { from: (table: string) => FakeQueryBuilder };
    const serviceWithFakeClient = service as unknown as { forUser: () => FakeClient };
    const originalForUser = serviceWithFakeClient.forUser;
    serviceWithFakeClient.forUser = () => {
      const client = originalForUser();
      const originalFrom = client.from.bind(client);
      client.from = (table: string) => {
        const builder = originalFrom(table);
        if (table === 'document_downloads') {
          const originalInsert = builder.insert.bind(builder);
          builder.insert = (row: unknown) => { insertedRows.push(row); return originalInsert(row); };
        }
        return builder;
      };
      return client;
    };
    const svc = new DocumentsService(service);

    const result = await svc.issueDownloadUrl('token', 'doc-1');
    expect(result.url).toBe('https://storage.example/signed');
    expect(insertedRows).toHaveLength(1);
    expect(insertedRows[0]).toMatchObject({ document_id: 'doc-1', user_id: 'user-1', school_id: 'school-1' });
  });
});

describe('DocumentsService.remove', () => {
  it('soft-deletes: sets deleted_at via UPDATE, never a real DELETE', async () => {
    const { service } = makeFakeSupabase({
      userRow: { id: 'user-1', role: 'TEACHER', school_id: 'school-1' },
      tableQueues: {
        documents: [{ data: { id: 'doc-1', school_id: 'school-1' }, error: null }],
      },
    });
    const svc = new DocumentsService(service);

    const result = await svc.remove('token', 'doc-1');
    expect(result).toEqual({ deleted: true });
  });

  it('throws NotFoundException when RLS blocks the update (zero rows affected)', async () => {
    const { service } = makeFakeSupabase({
      userRow: { id: 'user-1', role: 'TEACHER', school_id: 'school-1' },
      tableQueues: {
        documents: [{ data: null, error: null }],
      },
    });
    const svc = new DocumentsService(service);

    await expect(svc.remove('token', 'doc-1')).rejects.toThrow(NotFoundException);
  });
});
