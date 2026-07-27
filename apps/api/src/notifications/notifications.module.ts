import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationsScheduler } from './notifications.scheduler';
import { NotificationsController } from './notifications.controller';
import { AfricasTalkingClient } from './africastalking.client';

@Module({
  providers: [NotificationsService, NotificationsScheduler, AfricasTalkingClient],
  controllers: [NotificationsController],
  exports: [NotificationsService],
})
export class NotificationsModule {}
