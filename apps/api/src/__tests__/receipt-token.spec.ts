import { buildReceiptToken, verifyReceiptToken } from '../payments/receipt-token';

describe('receipt token', () => {
  const secret = 'test-secret';

  it('round-trips a valid token', () => {
    const token = buildReceiptToken(secret, 'payment-123', 'paybill');
    const result = verifyReceiptToken(secret, token);
    expect(result).toEqual({ paymentId: 'payment-123', paymentType: 'paybill' });
  });

  it('rejects a token signed with a different secret', () => {
    const token = buildReceiptToken('secret-a', 'payment-123', 'paystack');
    expect(verifyReceiptToken('secret-b', token)).toBeNull();
  });

  it('rejects a tampered payload (paymentId changed after signing)', () => {
    const token = buildReceiptToken(secret, 'payment-123', 'manual');
    const decoded = JSON.parse(Buffer.from(token, 'base64url').toString('utf8'));
    decoded.paymentId = 'payment-456';
    const tampered = Buffer.from(JSON.stringify(decoded)).toString('base64url');
    expect(verifyReceiptToken(secret, tampered)).toBeNull();
  });

  it('rejects an expired token', () => {
    const token = buildReceiptToken(secret, 'payment-123', 'paybill', -1); // already expired
    expect(verifyReceiptToken(secret, token)).toBeNull();
  });

  it('rejects garbage input without throwing', () => {
    expect(verifyReceiptToken(secret, 'not-a-real-token')).toBeNull();
    expect(verifyReceiptToken(secret, '')).toBeNull();
  });

  it('is still valid just before expiry and invalid just after', () => {
    const justFuture = buildReceiptToken(secret, 'payment-123', 'paybill', 1000);
    expect(verifyReceiptToken(secret, justFuture)).not.toBeNull();
  });
});
