import { Module } from '@nestjs/common';
import { SystemHealthController } from './system-health.controller';
import { SystemHealthService } from './system-health.service';
import { SuperAdminGuard } from '../common/guards/super-admin.guard';
import { PlatformPermissionGuard } from '../common/guards/platform-permission.guard';

@Module({
  controllers: [SystemHealthController],
  providers: [SystemHealthService, SuperAdminGuard, PlatformPermissionGuard],
})
export class SystemHealthModule {}
