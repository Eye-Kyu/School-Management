import { Injectable, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseService } from '../supabase/supabase.service';
import type { UploadDocumentInput, RetagDocumentInput, DocumentQuery } from '@school-manager/types';

const LIST_COLUMNS = 'id, title, file_name, file_size, mime_type, tags, scope_type, scope_subtype, scope_id, uploaded_by_id, created_at, updated_at, uploader:users!uploaded_by_id(full_name)';

const ASSIGNMENT_TABLE: Record<string, string> = {
  HOMEWORK: 'homework_assignments',
  QUIZ: 'quizzes',
  ONLINE_ASSIGNMENT: 'assignments',
};

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-150);
}

type UserRow = { id: string; role: string; school_id: string };

@Injectable()
export class DocumentsService {
  constructor(private readonly supabase: SupabaseService) {}

  async list(accessToken: string, query: DocumentQuery) {
    const client = this.supabase.forUser(accessToken);

    let builder = client
      .from('documents')
      .select(LIST_COLUMNS, { count: 'exact' })
      .order('created_at', { ascending: false });

    if (query.scopeType) builder = builder.eq('scope_type', query.scopeType);
    if (query.scopeSubtype) builder = builder.eq('scope_subtype', query.scopeSubtype);
    if (query.scopeId) builder = builder.eq('scope_id', query.scopeId);
    if (query.uploaderId) builder = builder.eq('uploaded_by_id', query.uploaderId);
    if (query.dateFrom) builder = builder.gte('created_at', query.dateFrom);
    if (query.dateTo) builder = builder.lte('created_at', `${query.dateTo}T23:59:59.999Z`);
    if (query.q) builder = builder.ilike('title', `%${query.q}%`);

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;
    const start = (page - 1) * pageSize;
    const end = start + pageSize - 1;

    const { data, error, count } = await builder.range(start, end);
    if (error) throw new BadRequestException(error.message);

    return { rows: data ?? [], total: count ?? 0, page, pageSize };
  }

  async upload(accessToken: string, file: Express.Multer.File, input: UploadDocumentInput) {
    const client = this.supabase.forUser(accessToken);

    const userRow = await this.supabase.currentUserRow(accessToken, 'id, role, school_id') as UserRow | null;
    if (!userRow || !['ADMIN', 'TEACHER'].includes(userRow.role)) {
      throw new ForbiddenException('Teacher or Admin role required');
    }

    await this.validateScope(client, userRow, input);

    const storagePath = `${userRow.school_id}/${randomUUID()}-${sanitizeFilename(file.originalname)}`;

    // Deliberate use of `admin`, not forUser(): the caller's role and scope
    // are already verified above via the RLS-respecting client, and after
    // BUG-11's fix (20260728000084) there is no `authenticated`-role Storage
    // write policy left at all — forUser() would fail on every upload
    // regardless of caller correctness. This performs the literal
    // bytes-to-Storage write on behalf of an already-validated request, not
    // a bypass of any check.
    const { error: uploadErr } = await this.supabase.admin.storage
      .from('documents')
      .upload(storagePath, file.buffer, { contentType: file.mimetype, upsert: false });
    if (uploadErr) throw new BadRequestException(uploadErr.message);

    const { data, error } = await client
      .from('documents')
      .insert({
        school_id: userRow.school_id,
        uploaded_by_id: userRow.id,
        title: input.title,
        file_name: file.originalname,
        file_size: file.size,
        mime_type: file.mimetype,
        storage_path: storagePath,
        scope_type: input.scopeType,
        scope_subtype: input.scopeSubtype ?? null,
        scope_id: input.scopeId ?? null,
        tags: input.tags,
      })
      .select(LIST_COLUMNS)
      .single();
    if (error) {
      // The row insert failed after the Storage object was already written
      // — clean up the orphan rather than leaving a dangling object (the
      // old browser-direct flow had exactly this partial-failure gap).
      await this.supabase.admin.storage.from('documents').remove([storagePath]);
      throw new Error(error.message);
    }

    await client.from('audit_logs').insert({
      id: randomUUID(),
      school_id: userRow.school_id,
      user_id: userRow.id,
      action: 'document.upload',
      entity_type: 'document',
      entity_id: data.id,
      metadata: { title: input.title, scopeType: input.scopeType, scopeSubtype: input.scopeSubtype ?? null, scopeId: input.scopeId ?? null, fileSize: file.size, fileName: file.originalname },
    });

    return data;
  }

  async issueDownloadUrl(accessToken: string, documentId: string) {
    const client = this.supabase.forUser(accessToken);

    const userRow = await this.supabase.currentUserRow(accessToken, 'id') as { id: string } | null;
    if (!userRow) throw new ForbiddenException('User not found');

    // The RLS-scoped read IS the access check (docs_select -> user_can_see_document()).
    // A caller who can't see the row gets nothing back, indistinguishable
    // from nonexistence — same fail-closed shape as every other RLS-scoped
    // .maybeSingle() lookup in this codebase.
    const { data: doc } = await client
      .from('documents')
      .select('id, school_id, storage_path')
      .eq('id', documentId)
      .maybeSingle();
    if (!doc) throw new NotFoundException('Document not found');

    const expiresIn = 300; // 5 minutes
    // Necessarily `.admin` — after BUG-11's fix there is no authenticated-role
    // Storage policy left to call this API as the user at all.
    const { data: signed, error } = await this.supabase.admin.storage
      .from('documents')
      .createSignedUrl(doc.storage_path, expiresIn);
    if (error || !signed) throw new Error(error?.message ?? 'Failed to sign URL');

    // Logged before returning the URL: once minted, a signed URL is a bearer
    // token redeemable directly against Storage with no further
    // app-mediated step to hook a log into — "issued" is the only
    // observable point, not literal retrieval confirmation.
    await client.from('document_downloads').insert({
      school_id: doc.school_id,
      document_id: doc.id,
      user_id: userRow.id,
    });

    return {
      url: signed.signedUrl,
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    };
  }

  async retag(accessToken: string, documentId: string, input: RetagDocumentInput) {
    const client = this.supabase.forUser(accessToken);

    const userRow = await this.supabase.currentUserRow(accessToken, 'id, role, school_id') as UserRow | null;
    if (!userRow) throw new ForbiddenException('User not found');

    const { data: existing } = await client
      .from('documents')
      .select('id, scope_type')
      .eq('id', documentId)
      .maybeSingle();
    if (!existing) throw new NotFoundException('Document not found');

    await this.validateScope(client, userRow, input);

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (input.title !== undefined) updates.title = input.title;
    if (input.tags !== undefined) updates.tags = input.tags;
    const previousScope = { scopeType: existing.scope_type };
    updates.scope_type = input.scopeType;
    updates.scope_subtype = input.scopeSubtype ?? null;
    updates.scope_id = input.scopeId ?? null;

    const { data, error } = await client
      .from('documents')
      .update(updates)
      .eq('id', documentId)
      .select(LIST_COLUMNS)
      .single();
    if (error) throw new BadRequestException(error.message);

    await client.from('audit_logs').insert({
      id: randomUUID(),
      school_id: userRow.school_id,
      user_id: userRow.id,
      action: 'document.retag',
      entity_type: 'document',
      entity_id: documentId,
      metadata: { previousScope, newScope: { scopeType: input.scopeType, scopeSubtype: input.scopeSubtype ?? null, scopeId: input.scopeId ?? null } },
    });

    return data;
  }

  async remove(accessToken: string, documentId: string) {
    const client = this.supabase.forUser(accessToken);

    const userRow = await this.supabase.currentUserRow(accessToken, 'id, role, school_id') as UserRow | null;
    if (!userRow) throw new ForbiddenException('User not found');

    const { data, error } = await client
      .from('documents')
      .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', documentId)
      .select('id, school_id')
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException('Document not found');

    await client.from('audit_logs').insert({
      id: randomUUID(),
      school_id: userRow.school_id,
      user_id: userRow.id,
      action: 'document.delete',
      entity_type: 'document',
      entity_id: documentId,
      metadata: {},
    });

    return { deleted: true };
  }

  async downloadCounts(accessToken: string, documentIds: string[]) {
    if (documentIds.length === 0) return [];
    const client = this.supabase.forUser(accessToken);
    const { data, error } = await client.rpc('document_download_counts', { p_document_ids: documentIds });
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  // App-layer validation of scope_id against its real target table, since
  // there's no FK (it can point into 4 different tables depending on
  // scope_type/scope_subtype) — mirrors AssessmentsService's source_id
  // validation precedent. The ASSIGNMENT branch's ownership check reuses
  // the same three-way split HomeworkService/QuizzesService already built
  // (homework_assignments.teacher_id needs a teachers.user_id join;
  // quizzes/assignments' created_by_id compares directly).
  private async validateScope(client: SupabaseClient, userRow: UserRow, input: { scopeType: string; scopeSubtype?: string; scopeId?: string }) {
    if (input.scopeType === 'SCHOOL_WIDE') {
      if (userRow.role !== 'ADMIN') {
        throw new ForbiddenException('Only an admin can publish a school-wide document');
      }
      return;
    }

    if (input.scopeType === 'CLASS') {
      const { data } = await client.from('classes').select('id').eq('id', input.scopeId).maybeSingle();
      if (!data) throw new BadRequestException('Class not found');
      if (userRow.role !== 'ADMIN') {
        const { data: teacherRow } = await client.from('teachers').select('id, is_class_teacher_of').eq('user_id', userRow.id).maybeSingle();
        const isClassTeacher = teacherRow?.is_class_teacher_of === input.scopeId;
        const { data: assignment } = teacherRow
          ? await client.from('subject_assignments').select('id').eq('teacher_id', teacherRow.id).eq('class_id', input.scopeId).maybeSingle()
          : { data: null };
        if (!isClassTeacher && !assignment) {
          throw new ForbiddenException('You are not assigned to this class');
        }
      }
      return;
    }

    if (input.scopeType === 'SUBJECT') {
      const { data } = await client.from('subjects').select('id').eq('id', input.scopeId).maybeSingle();
      if (!data) throw new BadRequestException('Subject not found');
      if (userRow.role !== 'ADMIN') {
        const { data: teacherRow } = await client.from('teachers').select('id').eq('user_id', userRow.id).maybeSingle();
        const { data: assignment } = teacherRow
          ? await client.from('subject_assignments').select('id').eq('teacher_id', teacherRow.id).eq('subject_id', input.scopeId).maybeSingle()
          : { data: null };
        if (!assignment) throw new ForbiddenException('You are not assigned to teach this subject');
      }
      return;
    }

    // ASSIGNMENT
    const table = ASSIGNMENT_TABLE[input.scopeSubtype ?? ''];
    if (!table) throw new BadRequestException('Invalid scopeSubtype');

    const ownerCol = table === 'homework_assignments' ? 'teacher_id' : 'created_by_id';
    const { data: row } = await client.from(table).select(`id, ${ownerCol}`).eq('id', input.scopeId).maybeSingle();
    if (!row) throw new BadRequestException(`${input.scopeSubtype} not found`);

    if (userRow.role !== 'ADMIN') {
      if (table === 'homework_assignments') {
        const { data: teacherRow } = await client.from('teachers').select('id').eq('user_id', userRow.id).maybeSingle();
        if (teacherRow?.id !== (row as unknown as { teacher_id: string }).teacher_id) {
          throw new ForbiddenException('Only the assignment creator or an admin can attach documents to it');
        }
      } else if ((row as unknown as { created_by_id: string }).created_by_id !== userRow.id) {
        throw new ForbiddenException('Only the assignment creator or an admin can attach documents to it');
      }
    }
  }
}
