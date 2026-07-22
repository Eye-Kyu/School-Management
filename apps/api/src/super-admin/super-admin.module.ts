import { Module } from '@nestjs/common';
import { SuperAdminController } from './super-admin.controller';
import { SuperAdminService } from './super-admin.service';
import { SuperAdminGuard } from '../common/guards/super-admin.guard';
import { PlatformPermissionGuard } from '../common/guards/platform-permission.guard';

@Module({
  controllers: [SuperAdminController],
  providers: [SuperAdminService, SuperAdminGuard, PlatformPermissionGuard],
  exports: [SuperAdminService],
})
export class SuperAdminModule {}
