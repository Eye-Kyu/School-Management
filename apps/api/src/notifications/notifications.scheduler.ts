import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { NotificationsService } from './notifications.service';

@Injectable()
export class NotificationsScheduler {
  constructor(private readonly svc: NotificationsService) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async dispatch() {
    await this.svc.dispatch();
  }
}
