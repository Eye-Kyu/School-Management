import { Module } from '@nestjs/common';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { SuperAdminGuard } from '../common/guards/super-admin.guard';
import { PlatformPermissionGuard } from '../common/guards/platform-permission.guard';

@Module({
  controllers: [BillingController],
  providers: [BillingService, SuperAdminGuard, PlatformPermissionGuard],
})
export class BillingModule {}
