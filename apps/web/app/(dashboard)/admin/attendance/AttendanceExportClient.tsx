'use client';

import { useState } from 'react';
import { apiFetch } from '@/lib/api';

type ClassOption = { id: string; name: string; grade_level: number };

export default function AttendanceExportClient({ classes }: { classes: ClassOption[] }) {
  const [classId, setClassId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');

  async function handleExport(e: React.FormEvent) {
    e.preventDefault();
    setExporting(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (classId) params.set('classId', classId);
      if (dateFrom) params.set('dateFrom', dateFrom);
      if (dateTo) params.set('dateTo', dateTo);

      const { csv, filename } = await apiFetch<{ csv: string; filename: string }>(
        `/attendance/export?${params.toString()}`,
      );
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  }

  return (
    <form onSubmit={handleExport} className="bg-white border border-slate-200 rounded-lg p-6 max-w-lg space-y-5">
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Class (optional)</label>
        <select
          value={classId}
          onChange={(e) => setClassId(e.target.value)}
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        >
          <option value="">All classes</option>
          {classes.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">From date</label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">To date</label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
      </div>

      <p className="text-xs text-slate-400">
        Leave filters empty to export all attendance records. Large exports may take a moment.
      </p>

      {error && <p className="text-sm text-red-600 bg-red-50 rounded px-3 py-2">{error}</p>}

      <button
        type="submit"
        disabled={exporting}
        className="bg-slate-900 text-white px-5 py-2 rounded-md text-sm font-medium
                   hover:bg-slate-700 disabled:opacity-50"
      >
        {exporting ? 'Exporting…' : '↓ Download CSV'}
      </button>
    </form>
  );
}
