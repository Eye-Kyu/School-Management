import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard';
import { SuperAdminGuard } from '../common/guards/super-admin.guard';
import { PlatformPermissionGuard } from '../common/guards/platform-permission.guard';
import { RequirePlatformPermission } from '../common/decorators/require-platform-permission.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  CreateSuperAdminInput,
  UpdateSuperAdminPermissionsInput,
  UpdateUserStatusInput,
  type CreateSuperAdminInput as CreateSuperAdminInputType,
  type UpdateSuperAdminPermissionsInput as UpdateSuperAdminPermissionsInputType,
  type UpdateUserStatusInput as UpdateUserStatusInputType,
} from '@school-manager/types';
import { PlatformUsersService } from './platform-users.service';

@ApiTags('super-admin-platform-users')
@ApiBearerAuth()
@UseGuards(AuthGuard, SuperAdminGuard, PlatformPermissionGuard)
@Controller('super-admin/platform-users')
export class PlatformUsersController {
  constructor(private readonly svc: PlatformUsersService) {}

  @ApiOperation({ summary: 'Cross-tenant search across all tenant users, for support/operations' })
  @RequirePlatformPermission('VIEW_PLATFORM_USERS')
  @Get()
  search(
    @Query('q') q?: string,
    @Query('role') role?: string,
    @Query('schoolId') schoolId?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.svc.search({ q, role, schoolId, page: page ? Number(page) : undefined, pageSize: pageSize ? Number(pageSize) : undefined });
  }

  @ApiOperation({ summary: "Toggle a tenant user's active status" })
  @RequirePlatformPermission('MANAGE_PLATFORM_USERS')
  @Patch(':id/status')
  updateUserStatus(
    @CurrentUser() user: { id: string },
    @Param('id') userId: string,
    @Body(new ZodValidationPipe(UpdateUserStatusInput)) input: UpdateUserStatusInputType,
  ) {
    return this.svc.updateUserStatus(userId, input, user.id);
  }

  @ApiOperation({ summary: 'List all SUPER_ADMIN accounts with their platform_permissions' })
  @RequirePlatformPermission('VIEW_PLATFORM_USERS')
  @Get('super-admins')
  listSuperAdmins() {
    return this.svc.listSuperAdmins();
  }

  @ApiOperation({ summary: 'Create a new SUPER_ADMIN account (granted all platform permissions by default)' })
  @RequirePlatformPermission('MANAGE_PLATFORM_USERS')
  @Post('super-admins')
  createSuperAdmin(
    @CurrentUser() user: { id: string },
    @Body(new ZodValidationPipe(CreateSuperAdminInput)) input: CreateSuperAdminInputType,
  ) {
    return this.svc.createSuperAdmin(input, user.id);
  }

  @ApiOperation({ summary: "Update a SUPER_ADMIN's platform_permissions" })
  @RequirePlatformPermission('MANAGE_PLATFORM_USERS')
  @Patch('super-admins/:id/permissions')
  updateSuperAdminPermissions(
    @CurrentUser() user: { id: string },
    @Param('id') userId: string,
    @Body(new ZodValidationPipe(UpdateSuperAdminPermissionsInput)) input: UpdateSuperAdminPermissionsInputType,
  ) {
    return this.svc.updateSuperAdminPermissions(userId, input, user.id);
  }
}
