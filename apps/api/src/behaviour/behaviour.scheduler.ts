import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SupabaseService } from '../supabase/supabase.service';

const JOB_KEY = 'best_student_recompute';

// Nightly recompute of "Best Student — Term X": the top-ranked student by
// signed behaviour points within each school's current term. Mirrors
// notifications.scheduler.ts's cron + system_job_runs pattern exactly.
@Injectable()
export class BehaviourScheduler {
  private readonly logger = new Logger(BehaviourScheduler.name);

  constructor(private readonly supabase: SupabaseService) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async recomputeBestStudents() {
    const now = new Date().toISOString();
    try {
      await this._run();
      await this.supabase.admin
        .from('system_job_runs')
        .upsert({ job_key: JOB_KEY, last_run_at: now, last_success_at: now, last_error: null, updated_at: now }, { onConflict: 'job_key' });
    } catch (err) {
      this.logger.error('Best Student recompute failed', err instanceof Error ? err.stack : String(err));
      await this.supabase.admin
        .from('system_job_runs')
        .upsert({ job_key: JOB_KEY, last_run_at: now, last_error: err instanceof Error ? err.message : String(err), updated_at: now }, { onConflict: 'job_key' });
    }
  }

  private async _run() {
    const { data: terms } = await this.supabase.admin
      .from('terms').select('id, school_id, start_date').eq('is_current', true);

    for (const term of terms ?? []) {
      const { data: points } = await this.supabase.admin
        .from('behaviour_points')
        .select('student_id, points, category')
        .eq('school_id', term.school_id)
        .gte('date', term.start_date);

      const totals = new Map<string, number>();
      for (const p of points ?? []) {
        const signed = p.category === 'NEGATIVE' ? -p.points : p.points;
        totals.set(p.student_id, (totals.get(p.student_id) ?? 0) + signed);
      }
      if (!totals.size) continue;

      const [topStudentId] = [...totals.entries()].sort((a, b) => b[1] - a[1])[0]!;

      // id is omitted deliberately — its column default only applies on a
      // true INSERT; on conflict-update this leaves the existing row's id
      // (and thus any future FK referencing it) untouched across reruns.
      await this.supabase.admin.from('best_student_awards').upsert({
        school_id: term.school_id,
        term_id: term.id,
        student_id: topStudentId,
        awarded_at: new Date().toISOString(),
      }, { onConflict: 'school_id,term_id' });
    }
  }
}
