import { Module } from '@nestjs/common';
import { PlatformPrivilegedAccessController } from './platform-privileged-access.controller';
import { PlatformPrivilegedAccessService } from './platform-privileged-access.service';
import { SuperAdminGuard } from '../common/guards/super-admin.guard';
import { PlatformPermissionGuard } from '../common/guards/platform-permission.guard';
import { SuperAdminModule } from '../super-admin/super-admin.module';

@Module({
  imports: [SuperAdminModule],
  controllers: [PlatformPrivilegedAccessController],
  providers: [PlatformPrivilegedAccessService, SuperAdminGuard, PlatformPermissionGuard],
})
export class PrivilegedAccessModule {}
