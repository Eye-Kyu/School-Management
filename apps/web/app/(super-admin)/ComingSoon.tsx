export default function ComingSoon({
  title,
  description,
  phase,
}: {
  title: string;
  description: string;
  phase: string;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{title}</h1>
        <p className="text-sm text-slate-500 mt-0.5">{description}</p>
      </div>
      <div className="rounded-xl border border-dashed border-slate-200 bg-white p-10 text-center">
        <p className="text-sm font-medium text-slate-500">Coming soon</p>
        <p className="text-xs text-slate-400 mt-1">Planned for {phase} of the control-plane refactor.</p>
      </div>
    </div>
  );
}
