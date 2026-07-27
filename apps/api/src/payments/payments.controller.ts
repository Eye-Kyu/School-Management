import {
  Controller, Post, Get, Delete, Param, Body, Headers, RawBodyRequest,
  UseGuards, Req, Res, Query, ForbiddenException, HttpCode,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard';
import { AccessToken } from '../common/decorators/current-user.decorator';
import { FeatureGuard } from '../common/guards/feature.guard';
import { RequireModule } from '../common/decorators/require-module.decorator';
import { PaymentsService } from './payments.service';
import { MpesaDarajaService, type DarajaC2BPayload } from './mpesa-daraja.service';
import { PaybillReconciliationService } from './paybill-reconciliation.service';
import { ReceiptPdfService, type ReceiptType } from './receipt-pdf.service';
import type { Request, Response } from 'express';

@ApiTags('payments')
@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly svc: PaymentsService,
    private readonly daraja: MpesaDarajaService,
    private readonly reconciliation: PaybillReconciliationService,
    private readonly receipts: ReceiptPdfService,
  ) {}

  @ApiOperation({ summary: 'Initialize a Paystack payment session' })
  @ApiBearerAuth()
  @UseGuards(AuthGuard, FeatureGuard)
  @RequireModule('payments')
  @Post('initialize')
  initialize(
    @AccessToken() token: string,
    @Body() body: { feeBalanceId: string; amount: number; currency?: string },
  ) {
    return this.svc.initializePayment(token, body);
  }

  @ApiOperation({ summary: 'Verify payment by reference (called after redirect back)' })
  @ApiBearerAuth()
  @UseGuards(AuthGuard, FeatureGuard)
  @RequireModule('payments')
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

  // ── M-Pesa Daraja C2B (Paybill) callbacks — public, IP-checked internally ──
  // Both must always return HTTP 200 with a Safaricom-shaped body — a
  // non-200 response makes Safaricom retry, which is never what we want
  // here, even for a genuine reject.

  @ApiOperation({ summary: 'Daraja C2B validation callback (no auth — IP-allowlisted, sandbox is permissive)' })
  @HttpCode(200)
  @Post('webhook/mpesa/paybill/validate')
  async mpesaValidate(@Body() body: DarajaC2BPayload, @Req() req: Request) {
    if (!this.daraja.isRequestFromSafaricom(req.ip ?? '')) {
      return { ResultCode: 'C2B00016', ResultDesc: 'Rejected' };
    }
    return this.daraja.validate(body);
  }

  @ApiOperation({ summary: 'Daraja C2B confirmation callback (no auth — IP-allowlisted, sandbox is permissive)' })
  @HttpCode(200)
  @Post('webhook/mpesa/paybill/confirm')
  async mpesaConfirm(@Body() body: DarajaC2BPayload, @Req() req: Request) {
    if (!this.daraja.isRequestFromSafaricom(req.ip ?? '')) {
      return { ResultCode: 1, ResultDesc: 'Rejected — untrusted source' };
    }
    return this.daraja.confirm(body);
  }

  // ── PDF receipts ──────────────────────────────────────────────────────

  @ApiOperation({ summary: 'Download a payment receipt as PDF — authenticated session or a signed short-lived link token' })
  @Get('receipts/:paymentId')
  async getReceipt(
    @Param('paymentId') paymentId: string,
    @Query('type') type: ReceiptType,
    @Query('token') token: string | undefined,
    @Headers('authorization') authHeader: string | undefined,
    @Headers('x-assist-token') assistHeader: string | undefined,
    @Res() res: Response,
  ) {
    const pdf = await this.receipts.getAuthorizedReceipt(paymentId, type, authHeader, assistHeader, token);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="receipt-${paymentId}.pdf"`);
    res.send(pdf);
  }

  // ── Paybill reconciliation dashboard ──────────────────────────────────

  @ApiOperation({ summary: 'Unmatched Paybill transactions awaiting admin review' })
  @ApiBearerAuth()
  @UseGuards(AuthGuard, FeatureGuard)
  @RequireModule('payments')
  @Get('paybill/unmatched')
  listUnmatched(@AccessToken() token: string) {
    return this.reconciliation.listUnmatched(token);
  }

  @ApiOperation({ summary: 'Matched Paybill transactions flagged as an overpayment' })
  @ApiBearerAuth()
  @UseGuards(AuthGuard, FeatureGuard)
  @RequireModule('payments')
  @Get('paybill/overpayments')
  listOverpayments(@AccessToken() token: string) {
    return this.reconciliation.listOverpayments(token);
  }

  @ApiOperation({ summary: 'Admin manually matches an unmatched (or fuzzy-suggested) Paybill transaction to a student' })
  @ApiBearerAuth()
  @UseGuards(AuthGuard, FeatureGuard)
  @RequireModule('payments')
  @Post('paybill/:id/match')
  manualMatch(
    @AccessToken() token: string,
    @Param('id') id: string,
    @Body() body: { studentId: string; note?: string; feeBalanceId?: string },
  ) {
    if (!body.studentId) throw new ForbiddenException('studentId is required');
    return this.reconciliation.manualMatch(token, id, body.studentId, body.note, body.feeBalanceId);
  }

  @ApiOperation({ summary: 'Admin records how an overpayment was resolved (credit next term / refund issued)' })
  @ApiBearerAuth()
  @UseGuards(AuthGuard, FeatureGuard)
  @RequireModule('payments')
  @Post('paybill/:id/resolve-overpayment')
  resolveOverpayment(
    @AccessToken() token: string,
    @Param('id') id: string,
    @Body() body: { resolution: string },
  ) {
    return this.reconciliation.resolveOverpayment(token, id, body.resolution);
  }

  @ApiOperation({ summary: 'Task 5.4 — unified, source-labeled, read-only feed across all three payment tables' })
  @ApiBearerAuth()
  @UseGuards(AuthGuard, FeatureGuard)
  @RequireModule('payments')
  @Get('unified')
  unifiedView(
    @AccessToken() token: string,
    @Query('studentId') studentId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.svc.unifiedPaymentView(token, { studentId, from, to });
  }

  @ApiOperation({ summary: 'List my payment transactions' })
  @ApiBearerAuth()
  @UseGuards(AuthGuard, FeatureGuard)
  @RequireModule('payments')
  @Get('transactions')
  listTransactions(@AccessToken() token: string) {
    return this.svc.listTransactions(token);
  }

  @ApiOperation({ summary: 'Admin reconciliation dashboard' })
  @ApiBearerAuth()
  @UseGuards(AuthGuard, FeatureGuard)
  @RequireModule('payments')
  @Get('reconciliation')
  reconciliationOverview(@AccessToken() token: string) {
    return this.svc.adminReconciliation(token);
  }

  // ── Webhook endpoints management ──────────────────────────

  @ApiBearerAuth()
  @UseGuards(AuthGuard, FeatureGuard)
  @RequireModule('api_webhooks')
  @Get('webhooks')
  listWebhooks(@AccessToken() token: string) {
    return this.svc.listWebhookEndpoints(token);
  }

  @ApiBearerAuth()
  @UseGuards(AuthGuard, FeatureGuard)
  @RequireModule('api_webhooks')
  @Post('webhooks')
  createWebhook(
    @AccessToken() token: string,
    @Body() body: { url: string; events: string[] },
  ) {
    return this.svc.createWebhookEndpoint(token, body);
  }

  @ApiBearerAuth()
  @UseGuards(AuthGuard, FeatureGuard)
  @RequireModule('api_webhooks')
  @Delete('webhooks/:id')
  deleteWebhook(@AccessToken() token: string, @Param('id') id: string) {
    return this.svc.deleteWebhookEndpoint(token, id);
  }
}
