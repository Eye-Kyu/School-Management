import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard';
import { SuperAdminGuard } from '../common/guards/super-admin.guard';
import { PlatformPermissionGuard } from '../common/guards/platform-permission.guard';
import { RequirePlatformPermission } from '../common/decorators/require-platform-permission.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  CreatePlatformInvoiceInput,
  UpdatePlatformInvoiceStatusInput,
  type CreatePlatformInvoiceInput as CreatePlatformInvoiceInputType,
  type UpdatePlatformInvoiceStatusInput as UpdatePlatformInvoiceStatusInputType,
} from '@school-manager/types';
import { BillingService } from './billing.service';

@ApiTags('super-admin-billing')
@ApiBearerAuth()
@UseGuards(AuthGuard, SuperAdminGuard, PlatformPermissionGuard)
@Controller('super-admin/billing')
export class BillingController {
  constructor(private readonly svc: BillingService) {}

  @ApiOperation({ summary: 'Platform-wide outstanding/collected totals and the current overdue-invoice list' })
  @RequirePlatformPermission('VIEW_BILLING')
  @Get('overview')
  getOverview() {
    return this.svc.getOverview();
  }

  @ApiOperation({ summary: "A school's full invoice history" })
  @RequirePlatformPermission('VIEW_BILLING')
  @Get('schools/:id/invoices')
  listSchoolInvoices(@Param('id') schoolId: string) {
    return this.svc.listSchoolInvoices(schoolId);
  }

  @ApiOperation({ summary: "Generate an invoice against a school's active subscription" })
  @RequirePlatformPermission('MANAGE_BILLING')
  @Post('schools/:id/invoices')
  createInvoice(
    @CurrentUser() user: { id: string },
    @Param('id') schoolId: string,
    @Body(new ZodValidationPipe(CreatePlatformInvoiceInput)) input: CreatePlatformInvoiceInputType,
  ) {
    return this.svc.createInvoice(schoolId, input, user.id);
  }

  @ApiOperation({ summary: 'Mark an invoice PAID or CANCELLED' })
  @RequirePlatformPermission('MANAGE_BILLING')
  @Patch('invoices/:id')
  updateInvoiceStatus(
    @CurrentUser() user: { id: string },
    @Param('id') invoiceId: string,
    @Body(new ZodValidationPipe(UpdatePlatformInvoiceStatusInput)) input: UpdatePlatformInvoiceStatusInputType,
  ) {
    return this.svc.updateInvoiceStatus(invoiceId, input, user.id);
  }
}
