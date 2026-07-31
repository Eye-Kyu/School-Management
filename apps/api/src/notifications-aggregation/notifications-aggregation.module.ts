import { Module } from '@nestjs/common';
import { NotificationsAggregationService } from './notifications-aggregation.service';
import { NotificationsAggregationController } from './notifications-aggregation.controller';
import { PaymentsModule } from '../payments/payments.module';

// A dedicated module, not an extension of NotificationsModule — PaymentsModule
// already imports NotificationsModule (to queue payment notifications), so
// NotificationsModule importing PaymentsModule back (needed for
// PaybillReconciliationService) would be circular. This module sits above
// both instead: NotificationsAggregationModule -> PaymentsModule ->
// NotificationsModule, one direction, no cycle. It does not need
// NotificationsService at all — Alerts reads the `notifications` table
// directly, same as the logic it replaces.
@Module({
  imports: [PaymentsModule],
  providers: [NotificationsAggregationService],
  controllers: [NotificationsAggregationController],
  exports: [NotificationsAggregationService],
})
export class NotificationsAggregationModule {}
