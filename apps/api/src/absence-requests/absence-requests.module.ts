import { Module } from '@nestjs/common';
import { AbsenceRequestsController } from './absence-requests.controller';
import { AbsenceRequestsService } from './absence-requests.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  controllers: [AbsenceRequestsController],
  providers: [AbsenceRequestsService],
  exports: [AbsenceRequestsService],
})
export class AbsenceRequestsModule {}
