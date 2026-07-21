import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard';
import { SuperAdminGuard } from '../common/guards/super-admin.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SuperAdminService } from './super-admin.service';

@ApiTags('super-admin')
@ApiBearerAuth()
@UseGuards(AuthGuard, SuperAdminGuard)
@Controller('super-admin')
export class SuperAdminController {
  constructor(private readonly svc: SuperAdminService) {}

  @ApiOperation({ summary: 'List all schools on the platform' })
  @Get('schools')
  listSchools() {
    return this.svc.listSchools();
  }

  @ApiOperation({ summary: "Get a school's full module catalogue with its entitlement state" })
  @Get('schools/:id/modules')
  getSchoolModules(@Param('id') schoolId: string) {
    return this.svc.getSchoolModules(schoolId);
  }

  @ApiOperation({ summary: 'Enable or disable a module for a specific school' })
  @Patch('schools/:id/modules/:key')
  toggleModule(
    @CurrentUser() user: { id: string },
    @Param('id') schoolId: string,
    @Param('key') moduleKey: string,
    @Body() body: { enabled: boolean },
  ) {
    return this.svc.toggleModule(schoolId, moduleKey, body.enabled, user.id);
  }
}
