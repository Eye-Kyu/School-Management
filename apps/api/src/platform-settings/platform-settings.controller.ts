import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard';
import { SuperAdminGuard } from '../common/guards/super-admin.guard';
import { PlatformPermissionGuard } from '../common/guards/platform-permission.guard';
import { RequirePlatformPermission } from '../common/decorators/require-platform-permission.decorator';
import { PlatformSettingsService } from './platform-settings.service';

@ApiTags('super-admin-settings')
@ApiBearerAuth()
@UseGuards(AuthGuard, SuperAdminGuard, PlatformPermissionGuard)
@Controller('super-admin/settings')
export class PlatformSettingsController {
  constructor(private readonly svc: PlatformSettingsService) {}

  @ApiOperation({ summary: 'Read-only platform configuration — the deployment env vars that actually shape behavior' })
  @RequirePlatformPermission('MANAGE_PLATFORM_SETTINGS')
  @Get('overview')
  getOverview() {
    return this.svc.getOverview();
  }
}
