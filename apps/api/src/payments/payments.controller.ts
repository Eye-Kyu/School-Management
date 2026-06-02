import {
  Controller, Post, Get, Delete, Param, Body, Headers, RawBodyRequest,
  UseGuards, Req,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard';
import { AccessToken } from '../common/decorators/current-user.decorator';
import { PaymentsService } from './payments.service';
import type { Request } from 'express';

@ApiTags('payments')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly svc: PaymentsService) {}

  @ApiOperation({ summary: 'Initialize a Paystack payment session' })
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @Post('initialize')
  initialize(
    @AccessToken() token: string,
    @Body() body: { feeBalanceId: string; amount: number; currency?: string },
  ) {
    return this.svc.initializePayment(token, body);
  }

  @ApiOperation({ summary: 'Verify payment by reference (called after redirect back)' })
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @Get('verify/:reference')
  verify(@Param('reference') reference: string) {
    return this.svc.verifyAndReconcile(reference);
  }

  @ApiOperation({ summary: 'Paystack webhook endpoint (no auth — signature verified internally)' })
  @Post('webhook/paystack')
  async paystackWebhook(
    @Headers('x-paystack-signature') signature: string,
    @Req() req: RawBodyRequest<Request>,
  ) {
    const raw = (req.rawBody ?? Buffer.alloc(0)).toString('utf8');
    await this.svc.handleWebhook(signature ?? '', raw);
    return { received: true };
  }

  @ApiOperation({ summary: 'List my payment transactions' })
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @Get('transactions')
  listTransactions(@AccessToken() token: string) {
    return this.svc.listTransactions(token);
  }

  @ApiOperation({ summary: 'Admin reconciliation dashboard' })
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @Get('reconciliation')
  reconciliation(@AccessToken() token: string) {
    return this.svc.adminReconciliation(token);
  }

  // ── Webhook endpoints management ──────────────────────────

  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @Get('webhooks')
  listWebhooks(@AccessToken() token: string) {
    return this.svc.listWebhookEndpoints(token);
  }

  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @Post('webhooks')
  createWebhook(
    @AccessToken() token: string,
    @Body() body: { url: string; events: string[] },
  ) {
    return this.svc.createWebhookEndpoint(token, body);
  }

  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @Delete('webhooks/:id')
  deleteWebhook(@AccessToken() token: string, @Param('id') id: string) {
    return this.svc.deleteWebhookEndpoint(token, id);
  }
}
