import { Controller, Get, Patch, Body, UseGuards } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { AuthGuard } from '../auth/auth.guard';
import { AccessToken } from '../common/decorators/current-user.decorator';

@Controller('notifications')
@UseGuards(AuthGuard)
export class NotificationsController {
  constructor(private readonly svc: NotificationsService) {}

  @Get()
  list(@AccessToken() token: string) {
    return this.svc.list(token);
  }

  @Get('unread-count')
  async unreadCount(@AccessToken() token: string) {
    const count = await this.svc.unreadCount(token);
    return { count };
  }

  @Patch('read')
  markRead(@AccessToken() token: string, @Body() body: { ids?: string[] }) {
    return this.svc.markRead(token, body.ids ?? []);
  }
}
