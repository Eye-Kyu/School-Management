import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { AccessToken, CurrentUser } from '../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { RecordPaymentInput } from '@school-manager/types';
import { FeesService } from './fees.service';

@Controller('fees')
@UseGuards(AuthGuard)
export class FeesController {
  constructor(private readonly fees: FeesService) {}

  @Get()
  list(@AccessToken() token: string) {
    return this.fees.list(token);
  }

  @Post('import')
  importCsv(
    @AccessToken() token: string,
    @CurrentUser() user: { id: string },
    @Body() body: { csv: string },
  ) {
    if (typeof body.csv !== 'string' || !body.csv.trim()) {
      throw new Error('csv field is required');
    }
    return this.fees.importCsv(token, user.id, body.csv);
  }

  @Post('payments')
  recordPayment(
    @AccessToken() token: string,
    @Body(new ZodValidationPipe(RecordPaymentInput)) body: RecordPaymentInput,
  ) {
    return this.fees.recordPayment(token, body);
  }

  @Get(':balanceId/payments')
  listPayments(@AccessToken() token: string, @Param('balanceId') id: string) {
    return this.fees.listPayments(token, id);
  }
}
