import BackButton from '@/components/BackButton';

export default function PrefectRoleInfoPage() {
  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-4">
        <BackButton href="/" />
        <h1 className="text-2xl font-semibold">About prefect roles</h1>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4 text-sm text-slate-600">
        <div>
          <h2 className="font-semibold text-slate-800 mb-1">Class Prefect</h2>
          <p>Assigned by a Class Teacher for their class. Depending on what the school has enabled, a Class Prefect may see their class&apos;s full behavior leaderboard, message their Class Teacher, report a behavior incident within their class, or view class attendance and timetable summaries.</p>
        </div>
        <div>
          <h2 className="font-semibold text-slate-800 mb-1">School Prefect</h2>
          <p>Assigned by a School Admin, with a role title the school chooses (e.g. Head Boy, Head Girl, Games Captain). Depending on what the school has enabled, a School Prefect may see their own ranking on the school-wide leaderboard, message a School Admin, or report a behavior incident about any student in the school.</p>
        </div>
        <p className="text-xs text-slate-400">
          Both roles are assigned directly by staff — there is no election process. A prefect retains every normal student ability; these are additional, revocable responsibilities layered on top.
        </p>
      </div>
    </div>
  );
}
