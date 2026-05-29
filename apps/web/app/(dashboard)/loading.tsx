export default function DashboardLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      {/* Header skeleton */}
      <div className="flex items-center gap-4">
        <div className="h-8 w-8 bg-slate-200 rounded-lg" />
        <div className="space-y-2">
          <div className="h-7 w-48 bg-slate-200 rounded-lg" />
          <div className="h-4 w-32 bg-slate-100 rounded" />
        </div>
      </div>

      {/* Cards skeleton */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="bg-white border border-slate-100 rounded-2xl overflow-hidden">
            <div className="h-24 bg-slate-200" />
            <div className="p-4 space-y-2">
              <div className="h-3 w-full bg-slate-100 rounded" />
              <div className="h-3 w-3/4 bg-slate-100 rounded" />
            </div>
          </div>
        ))}
      </div>

      {/* Content skeleton */}
      <div className="bg-white border border-slate-100 rounded-xl p-5 space-y-3">
        <div className="h-5 w-36 bg-slate-200 rounded" />
        {[...Array(4)].map((_, i) => (
          <div key={i} className="flex items-center gap-3 py-2 border-b border-slate-50">
            <div className="h-3 w-3/4 bg-slate-100 rounded" />
            <div className="h-3 w-16 bg-slate-100 rounded ml-auto" />
          </div>
        ))}
      </div>
    </div>
  );
}
