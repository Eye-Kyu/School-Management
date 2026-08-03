import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { HomeworkController } from './homework.controller';
import { HomeworkService } from './homework.service';

@Module({
  imports: [NotificationsModule],
  controllers: [HomeworkController],
  providers: [HomeworkService],
})
export class HomeworkModule {}
