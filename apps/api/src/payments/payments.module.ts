import { Module } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { NotificationsModule } from '../notifications/notifications.module';
import { MpesaDarajaService } from './mpesa-daraja.service';
import { PaybillReconciliationService } from './paybill-reconciliation.service';
import { ReceiptPdfService } from './receipt-pdf.service';

@Module({
  imports: [NotificationsModule],
  controllers: [PaymentsController],
  providers: [PaymentsService, MpesaDarajaService, PaybillReconciliationService, ReceiptPdfService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
