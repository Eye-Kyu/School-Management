import { Module } from '@nestjs/common';
import { PlatformMessagesController } from './platform-messages.controller';
import { PlatformMessagesService } from './platform-messages.service';
import { SuperAdminGuard } from '../common/guards/super-admin.guard';
import { PlatformPermissionGuard } from '../common/guards/platform-permission.guard';

@Module({
  controllers: [PlatformMessagesController],
  providers: [PlatformMessagesService, SuperAdminGuard, PlatformPermissionGuard],
})
export class PlatformMessagesModule {}
