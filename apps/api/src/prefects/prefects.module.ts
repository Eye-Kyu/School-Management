import { Module } from '@nestjs/common';
import { PrefectsController } from './prefects.controller';
import { PrefectsService } from './prefects.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  controllers: [PrefectsController],
  providers: [PrefectsService],
  exports: [PrefectsService],
})
export class PrefectsModule {}
