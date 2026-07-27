import { createClient } from '@/lib/supabase/server';
import BackButton from '@/components/BackButton';
import AnalyticsExport from './AnalyticsExport';

function StatCard({ label, value, sub, color = 'text-slate-800' }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div className="bg-white border border-slate-100 rounded-xl px-5 py-4">
      <p className="text-xs text-slate-400 uppercase tracking-wide font-medium">{label}</p>
      <p className={`text-3xl font-bold mt-1 ${color}`}>{value}</p>
      {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
    </div>
  );
}

function Bar({ pct, color = 'bg-slate-700', label }: { pct: number; color?: string; label?: string }) {
  return (
    <div className="space-y-1">
      {label && <div className="flex justify-between text-xs text-slate-500"><span className="truncate mr-2">{label}</span><span className="shrink-0 font-medium">{pct.toFixed(1)}%</span></div>}
      <div className="bg-slate-100 rounded-full h-2 overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
    </div>
  );
}

export default async function AdminAnalyticsPage({ searchParams }: { searchParams: { termId?: string } }) {
  const supabase = createClient();

  const { data: terms } = await supabase.from('terms').select('id, name, start_date, end_date, is_current').order('start_date', { ascending: false });
  const termId = searchParams.termId ?? (terms ?? []).find((t) => t.is_current)?.id ?? (terms ?? [])[0]?.id;
  const term = (terms ?? []).find((t) => t.id === termId);

  const [
    { count: studentCount },
    { count: teacherCount },
    { data: feeData },
    { data: classes },
    { data: subjects },
  ] = await Promise.all([
    supabase.from('students').select('*', { count: 'exact', head: true }).eq('is_active', true),
    supabase.from('teachers').select('*', { count: 'exact', head: true }),
    supabase.from('fee_balances').select('amount_due, amount_paid'),
    supabase.from('classes').select('id, name').eq('is_active', true).order('name'),
    supabase.from('subjects').select('id, name').order('name'),
  ]);

  const totalDue = (feeData ?? []).reduce((s, b) => s + Number(b.amount_due), 0);
  const totalPaid = (feeData ?? []).reduce((s, b) => s + Number(b.amount_paid), 0);
  const totalOutstanding = totalDue - totalPaid;
  const feeCollectionRate = totalDue > 0 ? (totalPaid / totalDue) * 100 : 0;

  // Attendance per class this term
  const { data: allStudents } = await supabase.from('students').select('id, current_class_id').eq('is_active', true);
  const { data: attRecords } = term
    ? await supabase.from('attendance_records')
        .select('student_id, status')
        .in('student_id', (allStudents ?? []).map((s) => s.id))
        .gte('date', term.start_date).lte('date', term.end_date)
    : { data: [] };

  const attByClass = (classes ?? []).map((c) => {
    const classStudentIds = new Set((allStudents ?? []).filter((s) => s.current_class_id === c.id).map((s) => s.id));
    const classAtt = (attRecords ?? []).filter((r) => classStudentIds.has(r.student_id));
    const present = classAtt.filter((r) => r.status === 'PRESENT' || r.status === 'LATE').length;
    const rate = classAtt.length ? (present / classAtt.length) * 100 : null;
    return { id: c.id, name: c.name, rate };
  }).filter((c) => c.rate != null).sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0));

  const overallAttPresent = (attRecords ?? []).filter((r) => r.status === 'PRESENT' || r.status === 'LATE').length;
  const overallAttRate = (attRecords ?? []).length ? (overallAttPresent / (attRecords ?? []).length) * 100 : null;

  // Exam pass rates per subject (grades ≥50%)
  const { data: assessments } = termId
    ? await supabase.from('assessments').select('id, subject_id, max_marks').eq('term_id', termId)
    : { data: [] };
  const aIds = (assessments ?? []).map((a) => a.id);
  const { data: allGrades } = aIds.length
    ? await supabase.from('grades').select('assessment_id, student_id, score').in('assessment_id', aIds)
    : { data: [] };

  const passRates = (subjects ?? []).map((s) => {
    const subAssessments = (assessments ?? []).filter((a) => a.subject_id === s.id);
    if (!subAssessments.length) return null;
    const subGrades = (allGrades ?? []).filter((g) => subAssessments.some((a) => a.id === g.assessment_id) && g.score != null);
    if (!subGrades.length) return null;
    const passing = subGrades.filter((g) => {
      const a = subAssessments.find((x) => x.id === g.assessment_id)!;
      return (g.score! / a.max_marks) * 100 >= 50;
    }).length;
    return { name: s.name, rate: (passing / subGrades.length) * 100, total: subGrades.length };
  }).filter(Boolean) as { name: string; rate: number; total: number }[];

  // Teacher workload
  const { data: workloadData } = await supabase
    .from('subject_assignments')
    .select('teacher_id, teacher:teachers!teacher_id(user:users!user_id(full_name))');
  const workloadMap: Record<string, { name: string; classes: number }> = {};
  for (const w of workloadData ?? []) {
    const tid = w.teacher_id;
    if (!workloadMap[tid]) {
      const name = ((w.teacher as any)?.user as any)?.full_name ?? 'Unknown';
      workloadMap[tid] = { name, classes: 0 };
    }
    workloadMap[tid]!.classes++;
  }
  const workload = Object.values(workloadMap).sort((a, b) => b.classes - a.classes).slice(0, 8);

  // SMS cost summary — this month / last month / last 30 days by day.
  // Queried directly (RLS-scoped to this admin's own school via msl_select_admin),
  // same direct-Supabase pattern as everything else on this page.
  const nowDate = new Date();
  const startOfThisMonth = new Date(nowDate.getFullYear(), nowDate.getMonth(), 1).toISOString();
  const startOfLastMonth = new Date(nowDate.getFullYear(), nowDate.getMonth() - 1, 1).toISOString();
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const smsWindowStart = startOfLastMonth < thirtyDaysAgo ? startOfLastMonth : thirtyDaysAgo;

  const { data: smsRows } = await supabase
    .from('message_send_log')
    .select('sent_at, cost_amount')
    .eq('channel', 'SMS')
    .gte('sent_at', smsWindowStart);

  const thisMonthSms = (smsRows ?? []).filter((r) => r.sent_at >= startOfThisMonth);
  const lastMonthSms = (smsRows ?? []).filter((r) => r.sent_at >= startOfLastMonth && r.sent_at < startOfThisMonth);
  const last30Sms = (smsRows ?? []).filter((r) => r.sent_at >= thirtyDaysAgo);

  const sumCost = (rows: { cost_amount: number | null }[]) => rows.reduce((s, r) => s + Number(r.cost_amount ?? 0), 0);
  const thisMonthSmsCount = thisMonthSms.length;
  const thisMonthSmsCost = sumCost(thisMonthSms);
  const lastMonthSmsCount = lastMonthSms.length;
  const lastMonthSmsCost = sumCost(lastMonthSms);

  const byDay: Record<string, { count: number; cost: number }> = {};
  for (const r of last30Sms) {
    const day = r.sent_at.slice(0, 10);
    (byDay[day] ??= { count: 0, cost: 0 });
    byDay[day]!.count += 1;
    byDay[day]!.cost += Number(r.cost_amount ?? 0);
  }
  const smsByDay = Object.entries(byDay).sort((a, b) => b[0].localeCompare(a[0]));

  const smsAlertThreshold = Number(process.env.SMS_MONTHLY_COST_ALERT_KES ?? 5000);
  const smsOverThreshold = thisMonthSmsCost > smsAlertThreshold;

  function csv(data: object[]) {
    if (!data.length) return '';
    const keys = Object.keys(data[0]!);
    return [keys.join(','), ...data.map((r) => keys.map((k) => `"${String((r as any)[k]).replace(/"/g, '""')}"`).join(','))].join('\n');
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <BackButton href="/admin" />
        <div>
          <h1 className="text-2xl font-semibold">School analytics</h1>
          <p className="text-sm text-slate-500 mt-0.5">School-wide performance overview.</p>
        </div>
      </div>

      <AnalyticsExport
        attendanceRows={attByClass.map((c) => ({ class: c.name, attendance_rate: `${c.rate!.toFixed(1)}%` }))}
        passRateRows={passRates.map((s) => ({ subject: s.name, pass_rate: `${s.rate.toFixed(1)}%`, total_grades: s.total }))}
        feeRows={{ total_due: totalDue, total_paid: totalPaid, outstanding: totalOutstanding, collection_rate: `${feeCollectionRate.toFixed(1)}%` }}
      />

      {/* Term selector */}
      <div className="flex gap-2 flex-wrap">
        {(terms ?? []).map((t) => (
          <a key={t.id} href={`/admin/analytics?termId=${t.id}`}
            className={`text-sm px-3 py-1 rounded-full font-medium ${t.id === termId ? 'bg-violet-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
            {t.name}{t.is_current ? ' (current)' : ''}
          </a>
        ))}
      </div>

      {/* Top stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Active students" value={studentCount ?? 0} />
        <StatCard label="Teachers" value={teacherCount ?? 0} />
        <StatCard label="Fees collected" value={`KES ${(totalPaid / 1000).toFixed(1)}k`} sub={`${feeCollectionRate.toFixed(1)}% collection rate`} color="text-emerald-700" />
        <StatCard label="Outstanding fees" value={`KES ${(totalOutstanding / 1000).toFixed(1)}k`} sub={`of KES ${(totalDue / 1000).toFixed(1)}k total`} color="text-rose-600" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Attendance by class */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-slate-800">Attendance by class</h2>
            {overallAttRate != null && (
              <span className={`text-sm font-bold ${overallAttRate >= 80 ? 'text-emerald-600' : 'text-amber-600'}`}>
                {overallAttRate.toFixed(1)}% overall
              </span>
            )}
          </div>
          {attByClass.length === 0 ? (
            <p className="text-sm text-slate-400">No attendance data for this term.</p>
          ) : (
            <div className="space-y-2.5">
              {attByClass.map((c) => (
                <Bar key={c.id} label={c.name} pct={c.rate!}
                  color={c.rate! >= 80 ? 'bg-emerald-500' : c.rate! >= 60 ? 'bg-amber-400' : 'bg-rose-500'} />
              ))}
            </div>
          )}
        </div>

        {/* Subject pass rates */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <h2 className="font-semibold text-slate-800">Subject pass rates (≥50%)</h2>
          {passRates.length === 0 ? (
            <p className="text-sm text-slate-400">No grades recorded this term.</p>
          ) : (
            <div className="space-y-2.5">
              {passRates.map((s) => (
                <Bar key={s.name} label={`${s.name} (${s.total} grades)`} pct={s.rate}
                  color={s.rate >= 70 ? 'bg-emerald-500' : s.rate >= 50 ? 'bg-amber-400' : 'bg-rose-500'} />
              ))}
            </div>
          )}
        </div>

        {/* Fees bar */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <h2 className="font-semibold text-slate-800">Fee collection</h2>
          <Bar pct={feeCollectionRate} color="bg-emerald-500" />
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div><p className="text-slate-400 text-xs">Collected</p><p className="font-semibold text-emerald-700">KES {totalPaid.toLocaleString()}</p></div>
            <div><p className="text-slate-400 text-xs">Outstanding</p><p className="font-semibold text-rose-600">KES {totalOutstanding.toLocaleString()}</p></div>
          </div>
        </div>

        {/* Teacher workload */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <h2 className="font-semibold text-slate-800">Teacher workload (classes assigned)</h2>
          {workload.length === 0 ? (
            <p className="text-sm text-slate-400">No assignments yet.</p>
          ) : (
            <div className="space-y-2.5">
              {workload.map((t) => {
                const maxClasses = workload[0]?.classes ?? 1;
                return <Bar key={t.name} label={`${t.name} — ${t.classes} class${t.classes !== 1 ? 'es' : ''}`} pct={(t.classes / maxClasses) * 100} />;
              })}
            </div>
          )}
        </div>

        {/* SMS cost summary */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <h2 className="font-semibold text-slate-800">SMS costs</h2>
          {smsOverThreshold && (
            <p className="text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              This month&apos;s SMS cost exceeds the alert threshold (KES {smsAlertThreshold.toLocaleString()}). Contact platform admin if this is unexpected.
            </p>
          )}
          {thisMonthSmsCount === 0 && lastMonthSmsCount === 0 ? (
            <p className="text-sm text-slate-400">No SMS sent yet this month. SMS activates when parents opt in and eligible notifications trigger.</p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-slate-400 text-xs">This month</p>
                  <p className="font-semibold text-slate-800">{thisMonthSmsCount} sent</p>
                  <p className="text-xs text-slate-500">KES {thisMonthSmsCost.toFixed(2)}</p>
                </div>
                <div>
                  <p className="text-slate-400 text-xs">Last month</p>
                  <p className="font-semibold text-slate-800">{lastMonthSmsCount} sent</p>
                  <p className="text-xs text-slate-500">KES {lastMonthSmsCost.toFixed(2)}</p>
                </div>
              </div>
              {smsByDay.length > 0 && (
                <div className="max-h-48 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-slate-400 text-left">
                        <th className="font-medium pb-1">Date</th>
                        <th className="font-medium pb-1 text-right">Sent</th>
                        <th className="font-medium pb-1 text-right">Cost (KES)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {smsByDay.map(([day, v]) => (
                        <tr key={day} className="border-t border-slate-50">
                          <td className="py-1 text-slate-600">{day}</td>
                          <td className="py-1 text-right text-slate-600">{v.count}</td>
                          <td className="py-1 text-right text-slate-600">{v.cost.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
