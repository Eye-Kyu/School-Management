import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { calculateSubjectAverage, assignLetterGrade } from '@school-manager/types';
import PrintButton from './PrintButton';
import CommentForm from './CommentForm';

export default async function ReportCardPage({
  params,
  searchParams,
}: {
  params: { studentId: string };
  searchParams: { termId?: string; edit?: string };
}) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: userRow } = await supabase
    .from('users').select('id, role').eq('auth_id', user.id).maybeSingle();

  // Fetch student + school
  const { data: student } = await supabase
    .from('students')
    .select('id, admission_no, current_class_id, user:users!user_id(full_name), class:classes!current_class_id(name, grade_level)')
    .eq('id', params.studentId)
    .maybeSingle();

  if (!student) redirect('/');

  // Terms
  const { data: terms } = await supabase
    .from('terms').select('id, name, is_current').order('start_date', { ascending: false });
  const termId = searchParams.termId ?? (terms ?? []).find((t) => t.is_current)?.id ?? (terms ?? [])[0]?.id;
  const term = (terms ?? []).find((t) => t.id === termId);

  // School info
  const { data: school } = await supabase
    .from('schools').select('name').maybeSingle();

  // Grades grouped by subject
  const { data: assessments } = await supabase
    .from('assessments')
    .select('id, name, max_marks, subject:subjects(id, name)')
    .eq('class_id', student.current_class_id ?? '')
    .eq('term_id', termId ?? '');

  const assessmentIds = (assessments ?? []).map((a) => a.id);
  const { data: grades } = assessmentIds.length
    ? await supabase.from('grades').select('assessment_id, score').eq('student_id', params.studentId).in('assessment_id', assessmentIds)
    : { data: [] };

  const gradeMap = Object.fromEntries((grades ?? []).map((g) => [g.assessment_id, g.score]));

  // Group by subject → average
  type SubjectRow = { name: string; assessmentCount: number; avg: number | null };
  const bySubject: Record<string, SubjectRow> = {};
  for (const a of assessments ?? []) {
    const sub = a.subject as unknown as { id: string; name: string } | null;
    if (!sub) continue;
    if (!bySubject[sub.id]) bySubject[sub.id] = { name: sub.name, assessmentCount: 0, avg: null };
    const row = bySubject[sub.id]!;
    row.assessmentCount++;
  }
  // Average percentage per subject — shared with report-card/[studentId]/page.tsx
  // via @school-manager/types (see packages/types/src/grading.ts).
  for (const subId of Object.keys(bySubject)) {
    const subAssessments = (assessments ?? []).filter((a) => (a.subject as any)?.id === subId);
    const scored = subAssessments.filter((a) => gradeMap[a.id] != null);
    bySubject[subId]!.avg = calculateSubjectAverage(scored.map((a) => ({ score: gradeMap[a.id]!, maxMarks: a.max_marks })));
  }

  // Attendance for the term
  const { data: termRow } = await supabase.from('terms').select('start_date, end_date').eq('id', termId ?? '').maybeSingle();
  const { data: attRecords } = termRow
    ? await supabase.from('attendance_records')
        .select('status').eq('student_id', params.studentId)
        .gte('date', termRow.start_date).lte('date', termRow.end_date)
    : { data: [] };
  const attTotal = (attRecords ?? []).length;
  const attPresent = (attRecords ?? []).filter((r) => r.status === 'PRESENT').length;
  const attLate = (attRecords ?? []).filter((r) => r.status === 'LATE').length;
  const attAbsent = (attRecords ?? []).filter((r) => r.status === 'ABSENT').length;
  const attRate = attTotal > 0 ? Math.round(((attPresent + attLate) / attTotal) * 100) : null;

  // Report card comments
  const { data: rc } = await supabase
    .from('student_report_cards')
    .select('id, class_teacher_comment, head_teacher_comment, is_published, locked_at, signer:users!signed_by_id(full_name)')
    .eq('student_id', params.studentId).eq('term_id', termId ?? '').maybeSingle();

  const isEditor = userRow?.role === 'ADMIN' || userRow?.role === 'TEACHER';

  // Only the class teacher of this student's class (or admin) may sign off —
  // enforced again server-side (RLS trigger) when the sign-off write happens.
  let canSign = userRow?.role === 'ADMIN';
  if (!canSign && userRow?.role === 'TEACHER') {
    const { data: teacherRow } = await supabase
      .from('teachers').select('is_class_teacher_of').eq('user_id', userRow.id).maybeSingle();
    canSign = !!teacherRow?.is_class_teacher_of && teacherRow.is_class_teacher_of === student.current_class_id;
  }
  const locked = !!rc?.locked_at;
  const signerName = (rc?.signer as unknown as { full_name: string } | null)?.full_name ?? null;
  const subjectRows = Object.values(bySubject);
  const overallAvg = subjectRows.filter((s) => s.avg != null).length
    ? subjectRows.filter((s) => s.avg != null).reduce((sum, s) => sum + s.avg!, 0) / subjectRows.filter((s) => s.avg != null).length
    : null;

  return (
    <div className="page">
      {/* Print / Edit controls */}
      <div className="no-print" style={{ marginBottom: 24, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <PrintButton />
        {(terms ?? []).length > 1 && (terms ?? []).map((t) => (
          <a key={t.id} href={`/print/report-card/${params.studentId}?termId=${t.id}`}
            style={{ fontSize: 12, padding: '4px 12px', borderRadius: 6, border: '1px solid #cbd5e1', background: t.id === termId ? '#0f172a' : 'white', color: t.id === termId ? 'white' : '#475569', textDecoration: 'none' }}>
            {t.name}
          </a>
        ))}
      </div>

      {/* ── Report card ── */}
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 16 }}>
        <tbody>
          <tr>
            <td style={{ textAlign: 'center', paddingBottom: 8 }}>
              <div style={{ fontSize: 18, fontWeight: 'bold', letterSpacing: 1 }}>{school?.name ?? 'School'}</div>
              <div style={{ fontSize: 14, marginTop: 4 }}>END OF TERM ACADEMIC REPORT</div>
              <div style={{ fontSize: 11, marginTop: 2, color: '#64748b' }}>{term?.name}</div>
            </td>
          </tr>
        </tbody>
      </table>

      <hr style={{ borderColor: '#1a1a1a', borderWidth: 2, marginBottom: 12 }} />

      {/* Student info */}
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 16, fontSize: 11 }}>
        <tbody>
          <tr>
            <td style={{ width: '50%', paddingBottom: 4 }}><b>Name:</b> {(student.user as any)?.full_name}</td>
            <td style={{ width: '50%', paddingBottom: 4 }}><b>Admission No:</b> {student.admission_no}</td>
          </tr>
          <tr>
            <td><b>Class:</b> {(student.class as any)?.name}</td>
            <td><b>Term:</b> {term?.name}</td>
          </tr>
        </tbody>
      </table>

      {/* Grades table */}
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 16, fontSize: 10 }}>
        <thead>
          <tr style={{ background: '#1e293b', color: 'white' }}>
            <th style={{ padding: '6px 8px', textAlign: 'left' }}>Subject</th>
            <th style={{ padding: '6px 8px', textAlign: 'center' }}>Assessments</th>
            <th style={{ padding: '6px 8px', textAlign: 'center' }}>Average (%)</th>
            <th style={{ padding: '6px 8px', textAlign: 'center' }}>Grade</th>
            <th style={{ padding: '6px 8px', textAlign: 'center' }}>Remarks</th>
          </tr>
        </thead>
        <tbody>
          {subjectRows.length === 0 ? (
            <tr><td colSpan={5} style={{ padding: '12px 8px', textAlign: 'center', color: '#94a3b8' }}>No grades recorded this term.</td></tr>
          ) : subjectRows.map((s, i) => {
            const pct = s.avg;
            const letter = pct != null ? assignLetterGrade(pct) : '—';
            const remarks = pct == null ? '—' : pct >= 70 ? 'Good' : pct >= 50 ? 'Average' : 'Below Average';
            return (
              <tr key={i} style={{ background: i % 2 ? '#f8fafc' : 'white', borderBottom: '1px solid #e2e8f0' }}>
                <td style={{ padding: '5px 8px' }}>{s.name}</td>
                <td style={{ padding: '5px 8px', textAlign: 'center' }}>{s.assessmentCount}</td>
                <td style={{ padding: '5px 8px', textAlign: 'center', fontWeight: 'bold' }}>{pct != null ? pct.toFixed(1) : '—'}</td>
                <td style={{ padding: '5px 8px', textAlign: 'center', fontWeight: 'bold', color: letter === 'A' || letter === 'B' ? '#16a34a' : letter === 'C' ? '#d97706' : '#dc2626' }}>{letter}</td>
                <td style={{ padding: '5px 8px', textAlign: 'center', color: '#64748b' }}>{remarks}</td>
              </tr>
            );
          })}
          {overallAvg != null && (
            <tr style={{ background: '#1e293b', color: 'white', fontWeight: 'bold' }}>
              <td style={{ padding: '6px 8px' }}>Overall</td>
              <td />
              <td style={{ padding: '6px 8px', textAlign: 'center' }}>{overallAvg.toFixed(1)}</td>
              <td style={{ padding: '6px 8px', textAlign: 'center' }}>{assignLetterGrade(overallAvg)}</td>
              <td />
            </tr>
          )}
        </tbody>
      </table>

      {/* Attendance */}
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 16, fontSize: 10 }}>
        <thead>
          <tr style={{ background: '#334155', color: 'white' }}>
            <th colSpan={5} style={{ padding: '5px 8px', textAlign: 'left' }}>Attendance Summary</th>
          </tr>
          <tr style={{ background: '#f1f5f9' }}>
            <th style={{ padding: '4px 8px', textAlign: 'center' }}>Total Days</th>
            <th style={{ padding: '4px 8px', textAlign: 'center' }}>Present</th>
            <th style={{ padding: '4px 8px', textAlign: 'center' }}>Late</th>
            <th style={{ padding: '4px 8px', textAlign: 'center' }}>Absent</th>
            <th style={{ padding: '4px 8px', textAlign: 'center' }}>Rate</th>
          </tr>
        </thead>
        <tbody>
          <tr style={{ textAlign: 'center', borderBottom: '1px solid #e2e8f0' }}>
            <td style={{ padding: '5px 8px' }}>{attTotal || '—'}</td>
            <td style={{ padding: '5px 8px', color: '#16a34a', fontWeight: 'bold' }}>{attPresent}</td>
            <td style={{ padding: '5px 8px', color: '#d97706' }}>{attLate}</td>
            <td style={{ padding: '5px 8px', color: '#dc2626' }}>{attAbsent}</td>
            <td style={{ padding: '5px 8px', fontWeight: 'bold' }}>{attRate != null ? `${attRate}%` : '—'}</td>
          </tr>
        </tbody>
      </table>

      {/* Comments */}
      {isEditor && searchParams.edit === '1' ? (
        <div className="no-print">
          <CommentForm
            studentId={params.studentId}
            termId={termId ?? ''}
            existing={rc ? { classTeacher: rc.class_teacher_comment ?? '', headTeacher: rc.head_teacher_comment ?? '', isPublished: rc.is_published } : null}
            locked={locked}
            canSign={canSign}
            isAdmin={userRow?.role === 'ADMIN'}
          />
        </div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 16, fontSize: 10 }}>
          <tbody>
            <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
              <td style={{ padding: '8px', width: '50%', verticalAlign: 'top' }}>
                <b>Class Teacher&apos;s Comment:</b>
                <div style={{ marginTop: 6, minHeight: 36, color: rc?.class_teacher_comment ? '#1a1a1a' : '#94a3b8', fontStyle: rc?.class_teacher_comment ? 'normal' : 'italic' }}>
                  {rc?.class_teacher_comment || 'No comment added yet.'}
                </div>
                {locked && signerName ? (
                  <div style={{ marginTop: 24, borderTop: '1px solid #94a3b8', paddingTop: 4, color: '#64748b' }}>
                    Signed: {signerName} on {new Date(rc!.locked_at as string).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </div>
                ) : (
                  <div style={{ marginTop: 24, borderTop: '1px solid #94a3b8', paddingTop: 4, color: '#64748b' }}>Signature &amp; Date: ___________________</div>
                )}
              </td>
              <td style={{ padding: '8px', width: '50%', verticalAlign: 'top', borderLeft: '1px solid #e2e8f0' }}>
                <b>Head Teacher&apos;s Comment:</b>
                <div style={{ marginTop: 6, minHeight: 36, color: rc?.head_teacher_comment ? '#1a1a1a' : '#94a3b8', fontStyle: rc?.head_teacher_comment ? 'normal' : 'italic' }}>
                  {rc?.head_teacher_comment || 'No comment added yet.'}
                </div>
                <div style={{ marginTop: 24, borderTop: '1px solid #94a3b8', paddingTop: 4, color: '#64748b' }}>Signature &amp; Date: ___________________</div>
              </td>
            </tr>
          </tbody>
        </table>
      )}

      {isEditor && searchParams.edit !== '1' && (
        <div className="no-print" style={{ marginTop: 16, display: 'flex', gap: 8 }}>
          <a href={`/print/report-card/${params.studentId}?termId=${termId}&edit=1`}
            style={{ fontSize: 12, padding: '6px 14px', borderRadius: 6, background: '#0f172a', color: 'white', textDecoration: 'none' }}>
            Edit comments
          </a>
          {!rc?.is_published && (
            <span style={{ fontSize: 11, color: '#94a3b8', alignSelf: 'center' }}>Not published to student/parent yet</span>
          )}
        </div>
      )}

      {/* Grade key */}
      <div style={{ marginTop: 16, fontSize: 9, color: '#64748b', borderTop: '1px solid #e2e8f0', paddingTop: 8 }}>
        Grade Key: A (80–100%) · B (70–79%) · C (60–69%) · D (50–59%) · E (below 50%)
      </div>
    </div>
  );
}
