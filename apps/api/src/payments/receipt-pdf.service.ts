import { Injectable, NotFoundException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import PDFDocument from 'pdfkit';
import { SupabaseService } from '../supabase/supabase.service';
import { verifyReceiptToken } from './receipt-token';
import { AssistModeClaims as AssistModeClaimsSchema } from '../common/assist-mode';

export type ReceiptType = 'paystack' | 'paybill' | 'manual';

export type ReceiptData = {
  schoolId: string | null;
  schoolName: string;
  schoolLogoUrl: string | null;
  receiptNumber: string;
  paymentDate: string;
  payerName: string;
  studentName: string;
  admissionNo: string | null;
  termName: string | null;
  amount: number;
  currency: string;
  runningBalance: number | null;
  paymentMethod: string;
  referenceNote: string;
  /** Who's allowed to see this receipt — used by the controller's authorization check, not rendered. */
  parentUserId: string | null;
  studentUserId: string | null;
};

/**
 * Generates a fixed-layout PDF receipt on demand — never pre-generated or
 * stored, per the task's own instruction (this is opened once, usually).
 * pdfkit chosen over @react-pdf/renderer or a headless browser: this lives
 * behind a NestJS endpoint with no React rendering need, and this exact
 * environment has no Docker/Chromium layer and already hit a build-time OOM
 * once this session — a plain Node drawing library has no such risk.
 */
@Injectable()
export class ReceiptPdfService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
  ) {}

  /**
   * Two access modes, per the task spec: (a) an authenticated session
   * belonging to the paying parent, the student, an admin at the same
   * school, or a SUPER_ADMIN with an active assist-mode grant scoped to
   * FINANCIAL_DATA for that school; (b) an unauthenticated signed
   * short-lived token (the SMS/email tap-from-phone case). This endpoint
   * reads via the service-role client (cross-table data no RLS session
   * would resolve on its own), so — unlike a frontend page — it needs this
   * explicit app-layer check rather than relying on RLS alone.
   */
  async getAuthorizedReceipt(
    paymentId: string,
    type: ReceiptType,
    authHeader: string | undefined,
    assistHeader: string | undefined,
    tokenParam: string | undefined,
  ): Promise<Buffer> {
    const data = await this.resolveReceiptData(paymentId, type);

    if (tokenParam) {
      const secret = this.config.get<string>('NOTIFICATION_HMAC_SECRET') ?? 'default-secret';
      const verified = verifyReceiptToken(secret, tokenParam);
      if (verified && verified.paymentId === paymentId && verified.paymentType === type) {
        return this.renderPdf(data);
      }
      throw new ForbiddenException('Invalid or expired receipt link');
    }

    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing or malformed Authorization header');
    }
    const accessToken = authHeader.slice('Bearer '.length).trim();
    const { data: authData, error: authErr } = await this.supabase.admin.auth.getUser(accessToken);
    if (authErr || !authData?.user) throw new UnauthorizedException('Invalid or expired token');

    const { data: caller } = await this.supabase.admin
      .from('users').select('id, role, school_id').eq('auth_id', authData.user.id).maybeSingle();
    if (!caller) throw new UnauthorizedException('User not found');

    const isPayingParent = data.parentUserId === caller.id;
    const isStudent = data.studentUserId === caller.id;
    const isSameSchoolAdmin = caller.role === 'ADMIN' && data.schoolId !== null && caller.school_id === data.schoolId;

    let isAssistAdmin = false;
    if (caller.role === 'SUPER_ADMIN' && assistHeader) {
      try {
        const payload = await this.jwt.verifyAsync(assistHeader);
        const claims = AssistModeClaimsSchema.parse(payload);
        const { data: grant } = await this.supabase.admin
          .from('privileged_access_grants')
          .select('status, expires_at, scopes, target_school_id')
          .eq('id', claims.accessGrantId)
          .maybeSingle();
        isAssistAdmin = !!grant
          && grant.status === 'ACTIVE'
          && new Date(grant.expires_at).getTime() > Date.now()
          && (grant.scopes as string[]).includes('FINANCIAL_DATA')
          && grant.target_school_id === data.schoolId;
      } catch {
        // Invalid/expired/tampered assist token — not assist-authorized, fall through.
      }
    }

    if (!isPayingParent && !isStudent && !isSameSchoolAdmin && !isAssistAdmin) {
      throw new ForbiddenException('You do not have access to this receipt');
    }

    return this.renderPdf(data);
  }

  async resolveReceiptData(paymentId: string, type: ReceiptType): Promise<ReceiptData> {
    if (type === 'paystack') return this.resolvePaystack(paymentId);
    if (type === 'paybill') return this.resolvePaybill(paymentId);
    return this.resolveManual(paymentId);
  }

  private async resolvePaystack(id: string): Promise<ReceiptData> {
    const { data: txn } = await this.supabase.admin
      .from('payment_transactions')
      .select(`
        id, amount, currency, reference, created_at, parent_user_id, school_id,
        school:schools!school_id(name, logo_url),
        student:students!student_id(admission_no, user_id, user:users!user_id(full_name)),
        fee_balance:fee_balances!fee_balance_id(amount_due, amount_paid, term:terms(name))
      `)
      .eq('id', id)
      .maybeSingle();
    if (!txn) throw new NotFoundException('Payment not found');

    const school = txn.school as unknown as { name: string; logo_url: string | null } | null;
    const student = txn.student as unknown as { admission_no: string; user_id: string; user: { full_name: string } } | null;
    const feeBalance = txn.fee_balance as unknown as { amount_due: number; amount_paid: number; term: { name: string } | null } | null;

    return {
      schoolId: txn.school_id,
      schoolName: school?.name ?? 'School',
      schoolLogoUrl: school?.logo_url ?? null,
      receiptNumber: txn.reference,
      paymentDate: txn.created_at,
      payerName: 'Guardian', // payment_transactions.parent_user_id resolved for auth only; name not worth a second round-trip
      studentName: student?.user?.full_name ?? 'Student',
      admissionNo: student?.admission_no ?? null,
      termName: feeBalance?.term?.name ?? null,
      amount: Number(txn.amount),
      currency: txn.currency,
      runningBalance: feeBalance ? Number(feeBalance.amount_due) - Number(feeBalance.amount_paid) : null,
      paymentMethod: 'Card / M-Pesa via Paystack',
      referenceNote: `Paystack reference: ${txn.reference}`,
      parentUserId: txn.parent_user_id,
      studentUserId: student?.user_id ?? null,
    };
  }

  private async resolvePaybill(id: string): Promise<ReceiptData> {
    const { data: txn } = await this.supabase.admin
      .from('payment_paybill_transactions')
      .select(`
        id, amount, currency, mpesa_receipt_number, transaction_time, raw_callback, school_id,
        matched_student:students!matched_student_id(admission_no, user_id, user:users!user_id(full_name), school:schools!school_id(name, logo_url)),
        matched_fee_balance:fee_balances!matched_fee_balance_id(amount_due, amount_paid, term:terms(name))
      `)
      .eq('id', id)
      .maybeSingle();
    if (!txn) throw new NotFoundException('Payment not found');

    const raw = txn.raw_callback as { FirstName?: string; MiddleName?: string; LastName?: string };
    const payerName = [raw?.FirstName, raw?.MiddleName, raw?.LastName].filter(Boolean).join(' ').trim() || 'Guardian';
    const student = txn.matched_student as unknown as { admission_no: string; user_id: string; user: { full_name: string }; school: { name: string; logo_url: string | null } } | null;
    const feeBalance = txn.matched_fee_balance as unknown as { amount_due: number; amount_paid: number; term: { name: string } | null } | null;

    return {
      schoolId: txn.school_id,
      schoolName: student?.school?.name ?? 'School',
      schoolLogoUrl: student?.school?.logo_url ?? null,
      receiptNumber: txn.mpesa_receipt_number,
      paymentDate: txn.transaction_time,
      payerName,
      studentName: student?.user?.full_name ?? 'Student',
      admissionNo: student?.admission_no ?? null,
      termName: feeBalance?.term?.name ?? null,
      amount: Number(txn.amount),
      currency: txn.currency,
      runningBalance: feeBalance ? Number(feeBalance.amount_due) - Number(feeBalance.amount_paid) : null,
      paymentMethod: 'M-Pesa Paybill',
      referenceNote: `M-Pesa receipt: ${txn.mpesa_receipt_number}`,
      parentUserId: null, // Paybill payments have no authenticated payer — access is via student/admin/token only
      studentUserId: student?.user_id ?? null,
    };
  }

  private async resolveManual(id: string): Promise<ReceiptData> {
    const { data: rec } = await this.supabase.admin
      .from('payment_records')
      .select(`
        id, amount, payment_method, reference_no, paid_date, school_id,
        school:schools!school_id(name, logo_url),
        student:students!student_id(admission_no, user_id, user:users!user_id(full_name)),
        fee_balance:fee_balances!fee_balance_id(amount_due, amount_paid, currency, term:terms(name))
      `)
      .eq('id', id)
      .maybeSingle();
    if (!rec) throw new NotFoundException('Payment not found');

    const school = rec.school as unknown as { name: string; logo_url: string | null } | null;
    const student = rec.student as unknown as { admission_no: string; user_id: string; user: { full_name: string } } | null;
    const feeBalance = rec.fee_balance as unknown as { amount_due: number; amount_paid: number; currency: string; term: { name: string } | null } | null;

    return {
      schoolId: rec.school_id,
      schoolName: school?.name ?? 'School',
      schoolLogoUrl: school?.logo_url ?? null,
      receiptNumber: rec.reference_no ?? rec.id,
      paymentDate: rec.paid_date,
      payerName: 'Guardian', // payment_records has no payer-user link at all
      studentName: student?.user?.full_name ?? 'Student',
      admissionNo: student?.admission_no ?? null,
      termName: feeBalance?.term?.name ?? null,
      amount: Number(rec.amount),
      currency: feeBalance?.currency ?? 'KES',
      runningBalance: feeBalance ? Number(feeBalance.amount_due) - Number(feeBalance.amount_paid) : null,
      paymentMethod: rec.payment_method,
      referenceNote: rec.reference_no ? `Reference: ${rec.reference_no}` : 'Recorded manually by school admin',
      parentUserId: null,
      studentUserId: student?.user_id ?? null,
    };
  }

  async renderPdf(data: ReceiptData): Promise<Buffer> {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    const done = new Promise<Buffer>((resolve, reject) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });

    if (data.schoolLogoUrl) {
      try {
        const res = await fetch(data.schoolLogoUrl);
        if (res.ok) {
          const buf = Buffer.from(await res.arrayBuffer());
          doc.image(buf, 50, 45, { width: 60 });
        }
      } catch {
        // Logo fetch failed — skip it silently, not fatal to the receipt itself.
      }
    }

    doc.fontSize(18).text(data.schoolName, 120, 50);
    doc.fontSize(10).fillColor('#555555').text('Payment Receipt', 120, 72);
    doc.moveDown(3);

    doc.fillColor('#000000').fontSize(11);
    const row = (label: string, value: string) => {
      doc.font('Helvetica-Bold').text(label, { continued: true, width: 200 });
      doc.font('Helvetica').text(`  ${value}`);
    };

    row('Receipt No:', data.receiptNumber);
    row('Date:', new Date(data.paymentDate).toLocaleString('en-KE'));
    row('Paid by:', data.payerName);
    row('Student:', data.studentName + (data.admissionNo ? ` (${data.admissionNo})` : ''));
    row('Term:', data.termName ?? '—');
    row('Payment method:', data.paymentMethod);
    doc.moveDown();

    doc.fontSize(14).font('Helvetica-Bold').text(`Amount paid: ${data.currency} ${data.amount.toLocaleString()}`);
    if (data.runningBalance != null) {
      doc.fontSize(11).font('Helvetica')
        .text(`Balance after this payment: ${data.currency} ${Math.max(0, data.runningBalance).toLocaleString()}`);
    }
    doc.moveDown();
    doc.fontSize(9).fillColor('#777777').text(data.referenceNote);

    doc.end();
    return done;
  }
}
