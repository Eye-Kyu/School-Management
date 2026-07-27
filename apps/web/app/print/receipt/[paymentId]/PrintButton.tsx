'use client';

export default function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      style={{
        fontSize: 12, padding: '6px 16px', borderRadius: 6,
        background: '#0f172a', color: 'white', border: 'none', cursor: 'pointer',
      }}
    >
      🖨 Print / Save as PDF
    </button>
  );
}
