import { Controller, Get, Patch, Post, Query, Body, UseGuards } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { AuthGuard } from '../auth/auth.guard';
import { AccessToken } from '../common/decorators/current-user.decorator';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly svc: NotificationsService) {}

  @UseGuards(AuthGuard)
  @Get()
  list(@AccessToken() token: string) {
    return this.svc.list(token);
  }

  @UseGuards(AuthGuard)
  @Get('unread-count')
  async unreadCount(@AccessToken() token: string) {
    const count = await this.svc.unreadCount(token);
    return { count };
  }

  @UseGuards(AuthGuard)
  @Patch('read')
  markRead(@AccessToken() token: string, @Body() body: { ids?: string[] }) {
    return this.svc.markRead(token, body.ids ?? []);
  }

  @UseGuards(AuthGuard)
  @Post('test')
  sendTest(@AccessToken() token: string, @Body() body: { title?: string; message?: string }) {
    return this.svc.sendTest(token, body.title, body.message);
  }

  // Public — no AuthGuard; signature is verified inside the service
  @Get('unsubscribe')
  unsubscribe(@Query('token') token: string) {
    return this.svc.handleUnsubscribe(token);
  }
}
