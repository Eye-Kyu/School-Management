// =============================================================================
// PrismaService - the admin DB client
// =============================================================================
// IMPORTANT: queries through this service BYPASS Row-Level Security.
// Use only for:
//   - Trusted system operations (signup, scheduled jobs, audit log writes)
//   - Admin tools where you've already verified the user's school context
//
// For user-scoped queries that should respect RLS, use SupabaseService.forUser()
// =============================================================================

import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@school-manager/db';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
