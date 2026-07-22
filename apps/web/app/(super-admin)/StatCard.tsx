export default function StatCard({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl px-5 py-4">
      <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">{label}</p>
      <p className={`text-3xl font-bold mt-1 ${accent ?? 'text-slate-800'}`}>{value.toLocaleString()}</p>
    </div>
  );
}
