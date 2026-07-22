import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard';
import { SuperAdminGuard } from '../common/guards/super-admin.guard';
import { PlatformPermissionGuard } from '../common/guards/platform-permission.guard';
import { RequirePlatformPermission } from '../common/decorators/require-platform-permission.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { CreatePrivilegedAccessGrantInput, type CreatePrivilegedAccessGrantInput as CreatePrivilegedAccessGrantInputType } from '@school-manager/types';
import { PlatformPrivilegedAccessService } from './platform-privileged-access.service';

@ApiTags('super-admin-privileged-access')
@ApiBearerAuth()
@UseGuards(AuthGuard, SuperAdminGuard, PlatformPermissionGuard)
@Controller('super-admin/privileged-access')
export class PlatformPrivilegedAccessController {
  constructor(private readonly svc: PlatformPrivilegedAccessService) {}

  @ApiOperation({ summary: 'Request/create a time-limited, scoped, read-only grant to view a school’s tenant data' })
  @RequirePlatformPermission('GRANT_PRIVILEGED_ACCESS')
  @Post('grants')
  createGrant(
    @CurrentUser() user: { id: string },
    @Body(new ZodValidationPipe(CreatePrivilegedAccessGrantInput)) input: CreatePrivilegedAccessGrantInputType,
  ) {
    return this.svc.createGrant(input, user.id);
  }

  @ApiOperation({ summary: "The caller's currently active grant, if any — powers the platform-wide privileged-access banner" })
  @RequirePlatformPermission('GRANT_PRIVILEGED_ACCESS')
  @Get('grants/active')
  getActiveGrant(@CurrentUser() user: { id: string }) {
    return this.svc.getActiveGrant(user.id);
  }

  @ApiOperation({ summary: 'Full privileged-access grant history, platform-wide' })
  @RequirePlatformPermission('VIEW_AUDIT_LOGS')
  @Get('grants')
  listGrants() {
    return this.svc.listGrants();
  }

  @ApiOperation({ summary: 'End an active privileged-access session early' })
  @RequirePlatformPermission('GRANT_PRIVILEGED_ACCESS')
  @Post('grants/:id/end')
  endGrant(@CurrentUser() user: { id: string }, @Param('id') grantId: string) {
    return this.svc.endGrant(grantId, user.id);
  }

  @ApiOperation({ summary: 'Scoped read: school aggregates, gated by an active SCHOOL_AGGREGATES grant' })
  @RequirePlatformPermission('GRANT_PRIVILEGED_ACCESS')
  @Get('schools/:id/aggregates')
  getSchoolAggregates(@CurrentUser() user: { id: string }, @Param('id') schoolId: string) {
    return this.svc.getSchoolAggregates(schoolId, user.id);
  }

  @ApiOperation({ summary: 'Scoped read: student records, gated by an active STUDENT_RECORDS grant' })
  @RequirePlatformPermission('GRANT_PRIVILEGED_ACCESS')
  @Get('schools/:id/students')
  getSchoolStudents(@CurrentUser() user: { id: string }, @Param('id') schoolId: string) {
    return this.svc.getSchoolStudents(schoolId, user.id);
  }

  @ApiOperation({ summary: 'Scoped read: assessment metadata, gated by an active ACADEMIC_DATA grant' })
  @RequirePlatformPermission('GRANT_PRIVILEGED_ACCESS')
  @Get('schools/:id/academic-data')
  getSchoolAcademicData(@CurrentUser() user: { id: string }, @Param('id') schoolId: string) {
    return this.svc.getSchoolAcademicData(schoolId, user.id);
  }

  @ApiOperation({ summary: 'Scoped read: attendance records, gated by an active ATTENDANCE grant' })
  @RequirePlatformPermission('GRANT_PRIVILEGED_ACCESS')
  @Get('schools/:id/attendance')
  getSchoolAttendance(@CurrentUser() user: { id: string }, @Param('id') schoolId: string) {
    return this.svc.getSchoolAttendance(schoolId, user.id);
  }

  @ApiOperation({ summary: 'Scoped read: fee balances, gated by an active FINANCIAL_DATA grant' })
  @RequirePlatformPermission('GRANT_PRIVILEGED_ACCESS')
  @Get('schools/:id/financials')
  getSchoolFinancials(@CurrentUser() user: { id: string }, @Param('id') schoolId: string) {
    return this.svc.getSchoolFinancials(schoolId, user.id);
  }

  @ApiOperation({ summary: 'Scoped read: document library metadata, gated by an active DOCUMENTS grant' })
  @RequirePlatformPermission('GRANT_PRIVILEGED_ACCESS')
  @Get('schools/:id/documents')
  getSchoolDocuments(@CurrentUser() user: { id: string }, @Param('id') schoolId: string) {
    return this.svc.getSchoolDocuments(schoolId, user.id);
  }

  @ApiOperation({ summary: 'Scoped read: conversation metadata only (no message bodies), gated by an active COMMUNICATION grant' })
  @RequirePlatformPermission('GRANT_PRIVILEGED_ACCESS')
  @Get('schools/:id/conversations')
  getSchoolConversations(@CurrentUser() user: { id: string }, @Param('id') schoolId: string) {
    return this.svc.getSchoolConversations(schoolId, user.id);
  }
}
