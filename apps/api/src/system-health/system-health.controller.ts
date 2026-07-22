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
}
