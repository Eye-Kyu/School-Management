import { Module } from '@nestjs/common';
import { AuditLogsController } from './audit-logs.controller';
import { AuditLogsService } from './audit-logs.service';
import { SuperAdminGuard } from '../common/guards/super-admin.guard';
import { PlatformPermissionGuard } from '../common/guards/platform-permission.guard';

@Module({
  controllers: [AuditLogsController],
  providers: [AuditLogsService, SuperAdminGuard, PlatformPermissionGuard],
})
export class AuditLogsModule {}
