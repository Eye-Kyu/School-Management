// =============================================================================
// Health check endpoint - unauthenticated, used by uptime monitors
// =============================================================================

import { Controller, Get } from '@nestjs/common';

@Controller()
export class AppController {
  @Get('health')
  health() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version ?? '0.0.0',
    };
  }
}
