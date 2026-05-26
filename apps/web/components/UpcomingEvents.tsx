type EventItem = {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  event_type: string;
};

const DEFAULT_STYLE = { chip: 'bg-slate-100 text-slate-600', dot: 'bg-slate-400' };

const TYPE_STYLES: Record<string, { chip: string; dot: string }> = {
  EXAM:    { chip: 'bg-rose-100 text-rose-700',       dot: 'bg-rose-500' },
  HOLIDAY: { chip: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-500' },
  PTA:     { chip: 'bg-violet-100 text-violet-700',   dot: 'bg-violet-500' },
  SPORTS:  { chip: 'bg-amber-100 text-amber-700',     dot: 'bg-amber-500' },
  GENERAL: DEFAULT_STYLE,
};

function formatEventDate(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);

  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === tomorrow.toDateString()) return 'Tomorrow';
  return d.toLocaleDateString('en-KE', { weekday: 'short', day: 'numeric', month: 'short' });
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit', hour12: true });
}

export default function UpcomingEvents({ events }: { events: EventItem[] }) {
  if (events.length === 0) {
    return (
      <section>
        <h2 className="text-base font-semibold mb-3 text-slate-700">Upcoming events</h2>
        <div className="rounded-xl border border-dashed border-slate-200 bg-white p-6 text-center text-sm text-slate-400">
          No upcoming events in the next 30 days.
        </div>
      </section>
    );
  }

  return (
    <section>
      <h2 className="text-base font-semibold mb-3 text-slate-700">Upcoming events</h2>
      <div className="space-y-2">
        {events.map((ev) => {
          const style = TYPE_STYLES[ev.event_type] ?? DEFAULT_STYLE;
          return (
            <div
              key={ev.id}
              className="bg-white border border-slate-100 rounded-xl px-4 py-3 flex items-center gap-4 shadow-sm"
            >
              {/* Date bubble */}
              <div className="shrink-0 w-12 text-center">
                <p className="text-xs font-semibold text-slate-500 leading-tight">
                  {new Date(ev.starts_at).toLocaleDateString('en-KE', { month: 'short' }).toUpperCase()}
                </p>
                <p className="text-xl font-bold text-slate-800 leading-tight">
                  {new Date(ev.starts_at).getDate()}
                </p>
              </div>

              {/* Divider */}
              <div className={`w-0.5 h-8 rounded-full shrink-0 ${style.dot}`} />

              {/* Content */}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-medium text-slate-800 truncate">{ev.title}</p>
                  <span className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded ${style.chip}`}>
                    {ev.event_type.toLowerCase()}
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-0.5">
                  {formatEventDate(ev.starts_at)}
                  {!ev.all_day && ` · ${formatTime(ev.starts_at)}`}
                  {ev.all_day && ' · All day'}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
