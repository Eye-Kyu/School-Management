import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard';
import { SuperAdminGuard } from '../common/guards/super-admin.guard';
import { PlatformPermissionGuard } from '../common/guards/platform-permission.guard';
import { RequirePlatformPermission } from '../common/decorators/require-platform-permission.decorator';
import { AccessToken } from '../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { SendPlatformMessageInput, type SendPlatformMessageInput as SendPlatformMessageInputType } from '@school-manager/types';
import { PlatformMessagesService } from './platform-messages.service';

@ApiTags('super-admin-platform-messages')
@ApiBearerAuth()
@UseGuards(AuthGuard, SuperAdminGuard, PlatformPermissionGuard)
@Controller('super-admin/platform-messages')
export class PlatformMessagesController {
  constructor(private readonly svc: PlatformMessagesService) {}

  @ApiOperation({ summary: 'Broadcast a one-way, in-app message to School Admins across the platform' })
  @RequirePlatformPermission('SEND_PLATFORM_MESSAGES')
  @Post()
  send(
    @AccessToken() token: string,
    @Body(new ZodValidationPipe(SendPlatformMessageInput)) input: SendPlatformMessageInputType,
  ) {
    return this.svc.send(token, input);
  }

  @ApiOperation({ summary: 'Messages this SuperAdmin has sent, with X-of-Y-read delivery status' })
  @RequirePlatformPermission('SEND_PLATFORM_MESSAGES')
  @Get()
  listSent(@AccessToken() token: string) {
    return this.svc.listSent(token);
  }
}
