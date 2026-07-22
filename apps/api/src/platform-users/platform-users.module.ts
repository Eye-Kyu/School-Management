import { Module } from '@nestjs/common';
import { PlatformUsersController } from './platform-users.controller';
import { PlatformUsersService } from './platform-users.service';
import { SuperAdminGuard } from '../common/guards/super-admin.guard';
import { PlatformPermissionGuard } from '../common/guards/platform-permission.guard';

@Module({
  controllers: [PlatformUsersController],
  providers: [PlatformUsersService, SuperAdminGuard, PlatformPermissionGuard],
})
export class PlatformUsersModule {}
