import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard';
import { SuperAdminGuard } from '../common/guards/super-admin.guard';
import { PlatformPermissionGuard } from '../common/guards/platform-permission.guard';
import { RequirePlatformPermission } from '../common/decorators/require-platform-permission.decorator';
import { AuditLogsService } from './audit-logs.service';

@ApiTags('super-admin-audit-logs')
@ApiBearerAuth()
@UseGuards(AuthGuard, SuperAdminGuard, PlatformPermissionGuard)
@Controller('super-admin/audit-logs')
export class AuditLogsController {
  constructor(private readonly svc: AuditLogsService) {}

  @ApiOperation({ summary: 'Searchable, filterable, paginated view over the platform-wide audit_logs table' })
  @RequirePlatformPermission('VIEW_AUDIT_LOGS')
  @Get()
  list(
    @Query('action') action?: string,
    @Query('entityType') entityType?: string,
    @Query('entityId') entityId?: string,
    @Query('schoolId') schoolId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('q') q?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.svc.list({
      action,
      entityType,
      entityId,
      schoolId,
      from,
      to,
      q,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }
}
