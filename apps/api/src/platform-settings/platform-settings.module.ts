import { Module } from '@nestjs/common';
import { PlatformSettingsController } from './platform-settings.controller';
import { PlatformSettingsService } from './platform-settings.service';
import { SuperAdminGuard } from '../common/guards/super-admin.guard';
import { PlatformPermissionGuard } from '../common/guards/platform-permission.guard';

@Module({
  controllers: [PlatformSettingsController],
  providers: [PlatformSettingsService, SuperAdminGuard, PlatformPermissionGuard],
})
export class PlatformSettingsModule {}
