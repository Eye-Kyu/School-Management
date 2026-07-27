import { ReceiptPdfService, type ReceiptData } from '../payments/receipt-pdf.service';

describe('ReceiptPdfService.renderPdf', () => {
  // renderPdf() never touches the DB/config/JWT — only resolveReceiptData()
  // and getAuthorizedReceipt() do, so plain stand-ins are fine here. `unknown`
  // (rather than `any`) still satisfies the constructor without tripping
  // @typescript-eslint/no-explicit-any.
  const service = new ReceiptPdfService(
    {} as unknown as ConstructorParameters<typeof ReceiptPdfService>[0],
    {} as unknown as ConstructorParameters<typeof ReceiptPdfService>[1],
    {} as unknown as ConstructorParameters<typeof ReceiptPdfService>[2],
  );

  const baseData: ReceiptData = {
    schoolId: null,
    schoolName: 'Test Academy',
    schoolLogoUrl: null,
    receiptNumber: 'RCT-001',
    paymentDate: new Date().toISOString(),
    payerName: 'Jane Doe',
    studentName: 'John Doe',
    admissionNo: 'ADM-001',
    termName: 'Term 1',
    amount: 5000,
    currency: 'KES',
    runningBalance: 2000,
    paymentMethod: 'M-Pesa Paybill',
    referenceNote: 'M-Pesa receipt: ABC123',
    parentUserId: null,
    studentUserId: null,
  };

  it('renders a valid, non-empty PDF for a complete payment', async () => {
    const buf = await service.renderPdf(baseData);
    expect(buf.length).toBeGreaterThan(0);
    expect(buf.subarray(0, 5).toString('utf8')).toBe('%PDF-');
  });

  it('renders without a term or running balance (both nullable at every hop)', async () => {
    const buf = await service.renderPdf({ ...baseData, termName: null, runningBalance: null });
    expect(buf.subarray(0, 5).toString('utf8')).toBe('%PDF-');
  });

  it('renders even when the school logo fetch fails (skipped, not fatal)', async () => {
    const buf = await service.renderPdf({ ...baseData, schoolLogoUrl: 'https://this-domain-does-not-exist.invalid/logo.png' });
    expect(buf.subarray(0, 5).toString('utf8')).toBe('%PDF-');
  });
});
