import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard';
import { SuperAdminGuard } from '../common/guards/super-admin.guard';
import { PlatformPermissionGuard } from '../common/guards/platform-permission.guard';
import { RequirePlatformPermission } from '../common/decorators/require-platform-permission.decorator';
import { SystemHealthService } from './system-health.service';

@ApiTags('super-admin-system-health')
@ApiBearerAuth()
@UseGuards(AuthGuard, SuperAdminGuard, PlatformPermissionGuard)
@Controller('super-admin/system-health')
export class SystemHealthController {
  constructor(private readonly svc: SystemHealthService) {}

  @ApiOperation({ summary: 'Real-time operational snapshot: API, database, auth, notifications, and payments' })
  @RequirePlatformPermission('VIEW_SYSTEM_HEALTH')
  @Get('overview')
  getOverview() {
    return this.svc.getOverview();
  }

  // Narrower permission than this controller's own route-level VIEW_SYSTEM_HEALTH
  // gate, matching what the old standalone Platform Settings page required —
  // preserves the exact prior permission boundary for this specific content.
  @ApiOperation({ summary: 'Read-only platform configuration — the deployment env vars that actually shape behavior' })
  @RequirePlatformPermission('MANAGE_PLATFORM_SETTINGS')
  @Get('configuration')
  getConfiguration() {
    return this.svc.getConfiguration();
  }
}
