import BackButton from '@/components/BackButton';
import AbsenceRequestReviewQueue from '@/components/AbsenceRequestReviewQueue';

export default function AdminAbsenceRequestsPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <BackButton href="/admin" />
        <div>
          <h1 className="text-2xl font-semibold">Absence requests</h1>
          <p className="text-sm text-slate-500 mt-0.5">Review parent-submitted absence requests. Approving auto-marks the date range Excused.</p>
        </div>
      </div>
      <AbsenceRequestReviewQueue />
    </div>
  );
}
