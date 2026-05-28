export default function PrintLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <style>{`
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body { font-family: 'Georgia', serif; font-size: 11pt; color: #1a1a1a; background: white; }
          @media print {
            body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
            .no-print { display: none !important; }
            @page { margin: 15mm 15mm 15mm 15mm; size: A4 portrait; }
          }
          @media screen {
            body { background: #e5e7eb; padding: 24px; }
            .page { background: white; max-width: 210mm; margin: 0 auto; padding: 20mm; box-shadow: 0 4px 24px rgba(0,0,0,0.15); }
          }
        `}</style>
      </head>
      <body>{children}</body>
    </html>
  );
}
