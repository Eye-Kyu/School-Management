'use client';

import { useState } from 'react';
import { apiFetch } from '@/lib/api';

type PowerRow = { id: string; power_code: string; applies_to: 'CLASS' | 'SCHOOL'; enabled: boolean; updated_at: string };

const LABELS: Record<string, string> = {
  view_class_behavior_leaderboard: 'View full class behavior leaderboard',
  compose_message_to_class_teacher: 'Message their Class Teacher',
  report_behavior_incident: 'Report a behavior incident (own class)',
  view_class_attendance_summary: 'View class attendance summary',
  view_class_timetable_detailed: 'View detailed class timetable',
  view_school_behavior_leaderboard_full: 'See own rank on school leaderboard',
  compose_message_to_admin: 'Message a School Admin',
  report_behavior_incident_school_wide: 'Report a behavior incident (school-wide)',
};

export default function PrefectPowersClient({ initialPowers }: { initialPowers: PowerRow[] }) {
  const [powers, setPowers] = useState(initialPowers);
  const [error, setError] = useState('');
  const [savingCode, setSavingCode] = useState<string | null>(null);

  async function toggle(power: PowerRow) {
    setSavingCode(power.power_code);
    setError('');
    const nextEnabled = !power.enabled;
    setPowers((prev) => prev.map((p) => (p.id === power.id ? { ...p, enabled: nextEnabled } : p)));
    try {
      await apiFetch('/prefects/powers', { method: 'PATCH', body: JSON.stringify({ powerCode: power.power_code, enabled: nextEnabled }) });
    } catch (err) {
      setPowers((prev) => prev.map((p) => (p.id === power.id ? { ...p, enabled: power.enabled } : p)));
      setError(err instanceof Error ? err.message : 'Failed to update');
    } finally {
      setSavingCode(null);
    }
  }

  const classPowers = powers.filter((p) => p.applies_to === 'CLASS');
  const schoolPowers = powers.filter((p) => p.applies_to === 'SCHOOL');

  function Section({ title, rows }: { title: string; rows: PowerRow[] }) {
    return (
      <div>
        <h2 className="text-sm font-semibold text-slate-700 mb-2">{title}</h2>
        <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
          {rows.map((p) => (
            <div key={p.id} className="flex items-center justify-between px-5 py-3">
              <span className="text-sm text-slate-700">{LABELS[p.power_code] ?? p.power_code}</span>
              <button
                onClick={() => toggle(p)}
                disabled={savingCode === p.power_code}
                aria-pressed={p.enabled}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-50 ${p.enabled ? 'bg-emerald-500' : 'bg-slate-200'}`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${p.enabled ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && <p className="text-sm text-rose-600 bg-rose-50 rounded-lg px-3 py-2">{error}</p>}
      <Section title="Class Prefect powers" rows={classPowers} />
      <Section title="School Prefect powers" rows={schoolPowers} />
    </div>
  );
}
