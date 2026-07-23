import { Controller, Get, Post, Query, UseGuards, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { AccessToken } from '../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { LeaderboardQuery, type LeaderboardQuery as LeaderboardQueryType } from '@school-manager/types';
import { SupabaseService } from '../supabase/supabase.service';
import { BehaviourService } from './behaviour.service';

@Controller('behaviour')
@UseGuards(AuthGuard)
export class BehaviourController {
  constructor(
    private readonly behaviour: BehaviourService,
    private readonly supabase: SupabaseService,
  ) {}

  @Get('leaderboard')
  leaderboard(
    @AccessToken() token: string,
    @Query(new ZodValidationPipe(LeaderboardQuery)) query: LeaderboardQueryType,
  ) {
    return this.behaviour.leaderboard(token, query);
  }

  // Fire-and-forget call from the (still frontend-direct-to-Supabase) mark
  // flow, so the leaderboard reflects a new point immediately rather than
  // waiting out the full 60s cache TTL. Not touching the insert flow itself.
  @Post('cache-bust')
  async bustCache(@AccessToken() token: string) {
    const userRow = await this.supabase.currentUserRow(token, 'school_id') as { school_id: string } | null;
    if (!userRow) throw new UnauthorizedException();
    this.behaviour.bustCache(userRow.school_id);
    return { ok: true };
  }
}
