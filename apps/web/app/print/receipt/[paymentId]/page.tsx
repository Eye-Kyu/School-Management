import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';

export default async function ReceiptPage({ params }: { params: { paymentId: string } }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: txn } = await supabase
    .from('payment_transactions')
    .select('id, reference, amount, currency, status, created_at, student:students!student_id(user:users!user_id(full_name), admission_no), parent:users!parent_user_id(full_name, email)')
    .eq('id', params.paymentId)
    .maybeSingle();

  const { data: school } = await supabase.from('schools').select('name').maybeSingle();

  if (!txn) redirect('/parent/fees');

  const parent = txn.parent as unknown as { full_name: string; email: string };
  const student = txn.student as unknown as { user: { full_name: string }; admission_no: string };

  return (
    <div className="page">
      <div className="no-print" style={{ marginBottom: 24 }}>
        <button onClick={() => window.print()} style={{ fontSize: 12, padding: '6px 16px', borderRadius: 6, background: '#0f172a', color: 'white', border: 'none', cursor: 'pointer' }}>
          🖨 Print / Save as PDF
        </button>
      </div>

      {/* Receipt */}
      <div style={{ textAlign: 'center', marginBottom: 24 }}>
        <h1 style={{ fontSize: 20, fontWeight: 'bold', letterSpacing: 1 }}>{school?.name ?? 'School'}</h1>
        <h2 style={{ fontSize: 15, marginTop: 4, color: '#475569' }}>OFFICIAL PAYMENT RECEIPT</h2>
      </div>

      <hr style={{ borderColor: '#1e293b', borderWidth: 2, marginBottom: 16 }} />

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, marginBottom: 16 }}>
        <tbody>
          <tr><td style={{ padding: '4px 0', width: '40%', color: '#64748b' }}>Receipt No:</td><td style={{ fontWeight: 'bold' }}>{txn.reference}</td></tr>
          <tr><td style={{ padding: '4px 0', color: '#64748b' }}>Date:</td><td>{new Date(txn.created_at).toLocaleDateString('en-KE', { day: 'numeric', month: 'long', year: 'numeric' })}</td></tr>
          <tr><td style={{ padding: '4px 0', color: '#64748b' }}>Parent / Guardian:</td><td>{parent?.full_name}</td></tr>
          <tr><td style={{ padding: '4px 0', color: '#64748b' }}>Student:</td><td>{student?.user?.full_name} ({student?.admission_no})</td></tr>
          <tr><td style={{ padding: '4px 0', color: '#64748b' }}>Payment method:</td><td>Online (M-Pesa / Card via Paystack)</td></tr>
        </tbody>
      </table>

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, marginBottom: 16 }}>
        <thead>
          <tr style={{ background: '#1e293b', color: 'white' }}>
            <th style={{ padding: '6px 8px', textAlign: 'left' }}>Description</th>
            <th style={{ padding: '6px 8px', textAlign: 'right' }}>Amount</th>
          </tr>
        </thead>
        <tbody>
          <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
            <td style={{ padding: '8px' }}>School fees payment</td>
            <td style={{ padding: '8px', textAlign: 'right', fontWeight: 'bold' }}>
              {txn.currency} {Number(txn.amount).toLocaleString()}
            </td>
          </tr>
          <tr style={{ background: '#f8fafc' }}>
            <td style={{ padding: '8px', fontWeight: 'bold' }}>TOTAL PAID</td>
            <td style={{ padding: '8px', textAlign: 'right', fontWeight: 'bold', fontSize: 13 }}>
              {txn.currency} {Number(txn.amount).toLocaleString()}
            </td>
          </tr>
        </tbody>
      </table>

      <div style={{ marginTop: 32, display: 'flex', justifyContent: 'space-between', fontSize: 10 }}>
        <div>
          <p style={{ borderTop: '1px solid #94a3b8', paddingTop: 4, color: '#64748b', marginTop: 32 }}>Cashier / System</p>
        </div>
        <div style={{ textAlign: 'right' }}>
          <p style={{ color: '#64748b' }}>Status: <strong style={{ color: txn.status === 'SUCCESS' ? '#16a34a' : '#dc2626' }}>{txn.status}</strong></p>
          <p style={{ color: '#64748b', marginTop: 4, fontSize: 9 }}>This is a computer-generated receipt.</p>
        </div>
      </div>
    </div>
  );
}
