import { Controller, Get, Patch, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { NotificationsAggregationService } from './notifications-aggregation.service';
import { AuthGuard } from '../auth/auth.guard';
import { AccessToken } from '../common/decorators/current-user.decorator';

@ApiTags('dashboard-feed')
@Controller('dashboard-feed')
export class NotificationsAggregationController {
  constructor(private readonly svc: NotificationsAggregationService) {}

  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @Get()
  getFeed(@AccessToken() token: string) {
    return this.svc.getFeed(token);
  }

  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @Get('unread-count')
  async unreadCount(@AccessToken() token: string) {
    const count = await this.svc.getUnreadCount(token);
    return { count };
  }

  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @Patch('read')
  markRead(@AccessToken() token: string, @Body() body: { ids?: string[] }) {
    return this.svc.markRead(token, body.ids ?? []);
  }
}
