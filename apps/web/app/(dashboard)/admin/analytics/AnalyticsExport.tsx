'use client';

type Row = Record<string, string | number>;

function downloadCsv(filename: string, rows: Row[]) {
  if (!rows.length) return;
  const keys = Object.keys(rows[0]!);
  const csv = [
    keys.join(','),
    ...rows.map((r) => keys.map((k) => `"${String(r[k] ?? '').replace(/"/g, '""')}"`).join(',')),
  ].join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = filename;
  a.click();
}

export default function AnalyticsExport({
  attendanceRows,
  passRateRows,
  feeRows,
}: {
  attendanceRows: { class: string; attendance_rate: string }[];
  passRateRows: { subject: string; pass_rate: string; total_grades: number }[];
  feeRows: { total_due: number; total_paid: number; outstanding: number; collection_rate: string };
}) {
  return (
    <div className="flex gap-2 flex-wrap">
      <button
        onClick={() => downloadCsv('attendance-by-class.csv', attendanceRows)}
        className="text-xs border border-slate-200 bg-white px-3 py-1.5 rounded-lg text-slate-600 hover:bg-slate-50"
      >
        ↓ Attendance CSV
      </button>
      <button
        onClick={() => downloadCsv('subject-pass-rates.csv', passRateRows)}
        className="text-xs border border-slate-200 bg-white px-3 py-1.5 rounded-lg text-slate-600 hover:bg-slate-50"
      >
        ↓ Pass rates CSV
      </button>
      <button
        onClick={() => downloadCsv('fees-summary.csv', [feeRows])}
        className="text-xs border border-slate-200 bg-white px-3 py-1.5 rounded-lg text-slate-600 hover:bg-slate-50"
      >
        ↓ Fees CSV
      </button>
    </div>
  );
}
