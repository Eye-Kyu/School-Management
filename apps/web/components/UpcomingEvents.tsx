type EventItem = {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  event_type: string;
};

const DEFAULT_STYLE = { chip: 'bg-slate-100 text-slate-700', dot: 'bg-slate-600' };

const TYPE_STYLES: Record<string, { chip: string; dot: string }> = {
  EXAM:    { chip: 'bg-rose-100 text-rose-800',       dot: 'bg-rose-700' },
  HOLIDAY: { chip: 'bg-emerald-100 text-emerald-800', dot: 'bg-emerald-700' },
  PTA:     { chip: 'bg-violet-100 text-violet-800',   dot: 'bg-violet-700' },
  SPORTS:  { chip: 'bg-amber-100 text-amber-800',     dot: 'bg-amber-700' },
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
        <h2 className="text-lg font-semibold mb-4">Upcoming events</h2>
        <div className="ruled-page text-sm text-slate-600">
          No upcoming events in the next 30 days.
        </div>
      </section>
    );
  }

  return (
    <section>
      <h2 className="text-lg font-semibold mb-4">Upcoming events</h2>
      <ul className="space-y-2">
        {events.map((ev) => {
          const style = TYPE_STYLES[ev.event_type] ?? DEFAULT_STYLE;
          return (
            <li
              key={ev.id}
              className="sheet px-3 py-3 flex items-center gap-4"
            >
              {/* Tear-off calendar date: the month band in the event's colour */}
              <div className="shrink-0 w-14 overflow-hidden rounded-lg text-center shadow-[inset_0_0_0_1px_var(--color-rule)]">
                <p className={`text-xs font-semibold leading-5 text-white ${style.dot}`}>
                  {new Date(ev.starts_at).toLocaleDateString('en-KE', { month: 'short' })}
                </p>
                <p className="text-xl font-semibold leading-8 tabular">
                  {new Date(ev.starts_at).getDate()}
                </p>
              </div>

              {/* Content */}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-semibold truncate">{ev.title}</p>
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${style.chip}`}>
                    {ev.event_type.charAt(0) + ev.event_type.slice(1).toLowerCase()}
                  </span>
                </div>
                <p className="text-sm text-slate-600 mt-0.5">
                  {formatEventDate(ev.starts_at)}
                  {!ev.all_day && `, ${formatTime(ev.starts_at)}`}
                  {ev.all_day && ', all day'}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
