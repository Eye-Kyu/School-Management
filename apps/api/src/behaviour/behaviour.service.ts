import { Injectable, ForbiddenException, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { SupabaseService } from '../supabase/supabase.service';
import type { LeaderboardQuery } from '@school-manager/types';

type LeaderboardRow = {
  studentId: string;
  fullName: string;
  total: number;
  breakdown: Record<string, number>;
};

type CacheEntry = { data: { rows: LeaderboardRow[]; capped: boolean; scope: string; window: string }; expiresAt: number };

const CACHE_TTL_MS = 60_000;

@Injectable()
export class BehaviourService {
  // Deliberately minimal — a Map with a TTL, not a general-purpose cache
  // abstraction. Busted per-school on every new point award (see bustCache).
  private cache = new Map<string, CacheEntry>();

  constructor(private readonly supabase: SupabaseService) {}

  async leaderboard(accessToken: string, query: LeaderboardQuery) {
    const userRow = await this.supabase.currentUserRow(accessToken, 'id, role, school_id') as
      { id: string; role: string; school_id: string } | null;
    if (!userRow) throw new UnauthorizedException();

    const { scope, classId, gradeLevel } = query;
    if (scope === 'class' && !classId) throw new BadRequestException('classId is required for scope=class');
    if (scope === 'grade' && gradeLevel === undefined) throw new BadRequestException('gradeLevel is required for scope=grade');

    // cap === null means "full ranking, no truncation" (Class Teacher's own
    // class, or Admin viewing any single class). Every other case is capped
    // at the top 20 — that cap is the load-bearing privacy protection for
    // students at the bottom of a ranking; never raise it beyond what the
    // visibility table below actually grants.
    let cap: number | null = 20;
    let auditFullClassView = false;

    if (userRow.role === 'ADMIN') {
      cap = scope === 'class' ? null : 20;
    } else if (userRow.role === 'TEACHER') {
      const { data: teacherRow } = await this.supabase.admin
        .from('teachers').select('id, is_class_teacher_of').eq('user_id', userRow.id).maybeSingle();
      if (scope === 'school') {
        cap = 20;
      } else if (scope === 'grade') {
        throw new ForbiddenException('Grade-level leaderboards are not visible to teachers');
      } else {
        // scope === 'class'
        if (teacherRow?.is_class_teacher_of && teacherRow.is_class_teacher_of === classId) {
          cap = null;
          auditFullClassView = true;
        } else {
          const { data: assignment } = await this.supabase.admin
            .from('subject_assignments').select('id').eq('teacher_id', teacherRow?.id ?? '').eq('class_id', classId).maybeSingle();
          if (!assignment) throw new ForbiddenException('You do not teach this class');
          cap = 20;
        }
      }
    } else if (userRow.role === 'STUDENT' || userRow.role === 'PARENT') {
      if (scope !== 'school') throw new ForbiddenException('Only the school-wide leaderboard is visible to you');
      cap = 20;
    } else {
      throw new ForbiddenException('Role not permitted to view the leaderboard');
    }

    const cacheKey = [userRow.school_id, query.window, scope, classId ?? '', gradeLevel ?? '', cap ?? 'full'].join(':');
    const cached = this.cache.get(cacheKey);
    if (auditFullClassView) await this._auditFullClassView(userRow.id, userRow.school_id, classId!);
    if (cached && cached.expiresAt > Date.now()) return cached.data;

    const result = await this._compute(accessToken, userRow.school_id, query, cap);
    this.cache.set(cacheKey, { data: result, expiresAt: Date.now() + CACHE_TTL_MS });
    return result;
  }

  // Called by BehaviourController after a new point is awarded — evicts
  // every cached leaderboard for the school rather than time-based expiry
  // alone, so the 60s cache never shows visibly stale data right after a
  // teacher marks a point.
  bustCache(schoolId: string) {
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${schoolId}:`)) this.cache.delete(key);
    }
  }

  private async _auditFullClassView(userId: string, schoolId: string, classId: string) {
    await this.supabase.admin.from('audit_logs').insert({
      id: randomUUID(),
      school_id: schoolId,
      user_id: userId,
      action: 'class_teacher.leaderboard_view_full',
      entity_type: 'class',
      entity_id: classId,
      metadata: {},
    });
  }

  private async _dateFrom(client: ReturnType<SupabaseService['forUser']>, window: LeaderboardQuery['window']): Promise<string | null> {
    const now = new Date();
    if (window === 'all') return null;
    if (window === 'week') {
      const day = now.getUTCDay(); // 0=Sun
      const diffToMonday = (day + 6) % 7;
      const monday = new Date(now);
      monday.setUTCDate(now.getUTCDate() - diffToMonday);
      return monday.toISOString().slice(0, 10);
    }
    if (window === 'month') {
      return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
    }
    // window === 'term'
    const { data: term } = await client.from('terms').select('start_date').eq('is_current', true).maybeSingle();
    return term?.start_date ?? null;
  }

  private async _compute(
    accessToken: string, schoolId: string, query: LeaderboardQuery, cap: number | null,
  ) {
    const client = this.supabase.forUser(accessToken);
    const dateFrom = await this._dateFrom(client, query.window);

    let classIds: string[] | null = null;
    if (query.scope === 'class') {
      classIds = [query.classId!];
    } else if (query.scope === 'grade') {
      const { data: classes } = await client.from('classes').select('id').eq('grade_level', query.gradeLevel!);
      classIds = (classes ?? []).map((c) => c.id);
      if (!classIds.length) return { rows: [], capped: cap !== null, scope: query.scope, window: query.window };
    }

    let q = client
      .from('behaviour_points')
      .select(`
        points, category, reason_category, student_id,
        student:students!inner(id, current_class_id, user:users!inner(full_name))
      `)
      .eq('school_id', schoolId);
    if (dateFrom) q = q.gte('date', dateFrom);
    if (classIds) q = q.in('student.current_class_id', classIds);

    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);

    type Row = {
      points: number; category: 'POSITIVE' | 'NEGATIVE'; reason_category: string | null; student_id: string;
      student: { id: string; current_class_id: string | null; user: { full_name: string } };
    };

    const totals = new Map<string, LeaderboardRow>();
    for (const r of (data ?? []) as unknown as Row[]) {
      const signed = r.category === 'NEGATIVE' ? -r.points : r.points;
      const existing = totals.get(r.student_id) ?? {
        studentId: r.student_id,
        fullName: r.student.user.full_name,
        total: 0,
        breakdown: {},
      };
      existing.total += signed;
      if (r.reason_category) {
        existing.breakdown[r.reason_category] = (existing.breakdown[r.reason_category] ?? 0) + signed;
      }
      totals.set(r.student_id, existing);
    }

    const ranked = [...totals.values()].sort((a, b) => b.total - a.total);
    const rows = cap !== null ? ranked.slice(0, cap) : ranked;

    return { rows, capped: cap !== null && ranked.length > rows.length, scope: query.scope, window: query.window };
  }
}
