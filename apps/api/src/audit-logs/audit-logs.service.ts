import { BadRequestException, Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

export type AuditLogQuery = {
  action?: string;
  entityType?: string;
  entityId?: string;
  schoolId?: string;
  from?: string;
  to?: string;
  q?: string;
  page?: number;
  pageSize?: number;
};

const DEFAULT_PAGE_SIZE = 50;
const MIN_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 200;

const SELECT_COLUMNS =
  'id, school_id, user_id, action, entity_type, entity_id, metadata, created_at, user:users(id, full_name, email, role), school:schools(id, name)';

@Injectable()
export class AuditLogsService {
  constructor(private readonly supabase: SupabaseService) {}

  async list(query: AuditLogQuery) {
    const page = Math.max(1, Math.floor(query.page ?? 1) || 1);
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(MIN_PAGE_SIZE, Math.floor(query.pageSize ?? DEFAULT_PAGE_SIZE) || DEFAULT_PAGE_SIZE));

    let builder = this.supabase.admin
      .from('audit_logs')
      .select(SELECT_COLUMNS, { count: 'exact' })
      .order('created_at', { ascending: false });

    if (query.action) builder = builder.eq('action', query.action);
    if (query.entityType) builder = builder.eq('entity_type', query.entityType);
    if (query.entityId) builder = builder.eq('entity_id', query.entityId);
    if (query.schoolId) builder = builder.eq('school_id', query.schoolId);
    if (query.from) builder = builder.gte('created_at', query.from);
    if (query.to) builder = builder.lte('created_at', this.endOfDay(query.to));

    if (query.q) {
      const orClause = await this.buildSearchClause(query.q);
      builder = builder.or(orClause);
    }

    const start = (page - 1) * pageSize;
    const end = start + pageSize - 1;
    const { data, error, count } = await builder.range(start, end);
    if (error) throw new BadRequestException(error.message);

    return { rows: data ?? [], total: count ?? 0, page, pageSize };
  }

  /** A date-only `to` (YYYY-MM-DD, from a native <input type="date">) should include the whole day. */
  private endOfDay(to: string): string {
    return /^\d{4}-\d{2}-\d{2}$/.test(to) ? `${to}T23:59:59.999Z` : to;
  }

  /**
   * Resolves free-text `q` into an `.or()` clause against audit_logs' own
   * columns — action text directly, or the ids of any user/school whose
   * name/email matched. Deliberately two upfront lookups rather than
   * filtering into the embedded user/school resources: PostgREST only
   * restricts parent rows via an embedded-resource filter when the embed
   * uses `!inner`, which is a sharper edge to depend on than two small
   * bounded queries.
   */
  private async buildSearchClause(q: string): Promise<string> {
    const escaped = q.replace(/"/g, '\\"');
    const like = `%${escaped}%`;

    const [{ data: users }, { data: schools }] = await Promise.all([
      this.supabase.admin.from('users').select('id').or(`full_name.ilike."${like}",email.ilike."${like}"`).limit(50),
      this.supabase.admin.from('schools').select('id').ilike('name', like).limit(50),
    ]);

    const clauses = [`action.ilike."${like}"`];
    const userIds = (users ?? []).map((u) => u.id);
    const schoolIds = (schools ?? []).map((s) => s.id);
    if (userIds.length) clauses.push(`user_id.in.(${userIds.join(',')})`);
    if (schoolIds.length) clauses.push(`school_id.in.(${schoolIds.join(',')})`);

    return clauses.join(',');
  }
}
