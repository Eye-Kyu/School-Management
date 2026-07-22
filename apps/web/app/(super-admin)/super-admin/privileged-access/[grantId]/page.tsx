'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import BackButton from '@/components/BackButton';
import { apiFetch, ApiError } from '@/lib/api';
import StatCard from '../../../StatCard';
import {
  formatRemaining,
  notifyPrivilegedAccessChanged,
  PRIVILEGED_ACCESS_SCOPE_LABELS,
  type PrivilegedAccessGrant,
} from '@/lib/privilegedAccess';

type SchoolOverview = {
  users: {
    total: number;
    byRole: { ADMIN: number; TEACHER: number; STUDENT: number; PARENT: number };
    active: number;
    inactive: number;
    newThisMonth: number;
  };
  academic: {
    classCount: number;
    subjectCount: number;
    studentsPerGrade: Record<string, number>;
    attendance: { recordCount: number; presentRate: number | null };
    assessmentsCreatedLast30Days: number;
    gradesRecordedLast30Days: number;
  };
  engagement: {
    dau: number;
    wau: number;
    mau: number;
    loginsByRoleLast7Days: { ADMIN: number; TEACHER: number; STUDENT: number; PARENT: number };
  };
};

type StudentRow = {
  id: string;
  admission_no: string;
  gender: string | null;
  enrollment_date: string | null;
  is_active: boolean;
  current_class_id: string | null;
  user: { id: string; full_name: string; email: string | null; phone: string | null } | null;
  class: { id: string; name: string; grade_level: number } | null;
};

type AssessmentRow = {
  id: string;
  name: string;
  max_marks: number;
  assessment_date: string | null;
  created_at: string;
  term: { id: string; name: string } | null;
  class: { id: string; name: string } | null;
  subject: { id: string; name: string; code: string | null } | null;
};

type AttendanceRow = {
  id: string;
  date: string;
  status: string;
  note: string | null;
  student: { admission_no: string; user: { full_name: string } } | null;
  class: { name: string } | null;
};

type FinancialRow = {
  id: string;
  amount_due: number;
  amount_paid: number;
  currency: string;
  as_of_date: string | null;
  student: { id: string; admission_no: string; user: { full_name: string } } | null;
  term: { id: string; name: string } | null;
};

type DocumentRow = {
  id: string;
  title: string;
  file_url: string;
  file_name: string;
  mime_type: string | null;
  created_at: string;
  uploader: { full_name: string } | null;
};

type ConversationRow = {
  id: string;
  last_message_at: string | null;
  is_flagged: boolean;
  created_at: string;
  parent: { id: string; full_name: string } | null;
  teacher: { id: string; full_name: string } | null;
  student: { id: string; user: { full_name: string } | null } | null;
};

export default function PrivilegedAccessViewerPage() {
  const params = useParams<{ grantId: string }>();
  const grantId = params.grantId;
  const router = useRouter();

  const [grant, setGrant] = useState<PrivilegedAccessGrant | null>(null);
  const [grantLoading, setGrantLoading] = useState(true);
  const [overview, setOverview] = useState<SchoolOverview | null>(null);
  const [students, setStudents] = useState<StudentRow[] | null>(null);
  const [assessments, setAssessments] = useState<AssessmentRow[] | null>(null);
  const [attendance, setAttendance] = useState<AttendanceRow[] | null>(null);
  const [financials, setFinancials] = useState<FinancialRow[] | null>(null);
  const [documents, setDocuments] = useState<DocumentRow[] | null>(null);
  const [conversations, setConversations] = useState<ConversationRow[] | null>(null);
  const [err, setErr] = useState('');
  const [ending, setEnding] = useState(false);

  useEffect(() => {
    apiFetch<PrivilegedAccessGrant | null>('/super-admin/privileged-access/grants/active')
      .then((active) => setGrant(active && active.id === grantId ? active : null))
      .catch(() => setGrant(null))
      .finally(() => setGrantLoading(false));
  }, [grantId]);

  useEffect(() => {
    if (!grant) return;
    const schoolId = grant.targetSchoolId;
    if (grant.scopes.includes('SCHOOL_AGGREGATES')) {
      apiFetch<SchoolOverview>(`/super-admin/privileged-access/schools/${schoolId}/aggregates`)
        .then(setOverview)
        .catch((e) => setErr(e instanceof Error ? e.message : 'Failed to load school aggregates'));
    }
    if (grant.scopes.includes('STUDENT_RECORDS')) {
      apiFetch<StudentRow[]>(`/super-admin/privileged-access/schools/${schoolId}/students`)
        .then(setStudents)
        .catch((e) => setErr(e instanceof Error ? e.message : 'Failed to load student records'));
    }
    if (grant.scopes.includes('ACADEMIC_DATA')) {
      apiFetch<AssessmentRow[]>(`/super-admin/privileged-access/schools/${schoolId}/academic-data`)
        .then(setAssessments)
        .catch((e) => setErr(e instanceof Error ? e.message : 'Failed to load academic data'));
    }
    if (grant.scopes.includes('ATTENDANCE')) {
      apiFetch<AttendanceRow[]>(`/super-admin/privileged-access/schools/${schoolId}/attendance`)
        .then(setAttendance)
        .catch((e) => setErr(e instanceof Error ? e.message : 'Failed to load attendance'));
    }
    if (grant.scopes.includes('FINANCIAL_DATA')) {
      apiFetch<FinancialRow[]>(`/super-admin/privileged-access/schools/${schoolId}/financials`)
        .then(setFinancials)
        .catch((e) => setErr(e instanceof Error ? e.message : 'Failed to load financial data'));
    }
    if (grant.scopes.includes('DOCUMENTS')) {
      apiFetch<DocumentRow[]>(`/super-admin/privileged-access/schools/${schoolId}/documents`)
        .then(setDocuments)
        .catch((e) => setErr(e instanceof Error ? e.message : 'Failed to load documents'));
    }
    if (grant.scopes.includes('COMMUNICATION')) {
      apiFetch<ConversationRow[]>(`/super-admin/privileged-access/schools/${schoolId}/conversations`)
        .then(setConversations)
        .catch((e) => setErr(e instanceof Error ? e.message : 'Failed to load conversations'));
    }
  }, [grant]);

  async function endSession() {
    if (!grant) return;
    if (!confirm('End this privileged access session now?')) return;
    setEnding(true);
    try {
      await apiFetch(`/super-admin/privileged-access/grants/${grant.id}/end`, { method: 'POST' });
      notifyPrivilegedAccessChanged();
      router.push(`/super-admin/schools/${grant.targetSchoolId}`);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Failed to end session');
    } finally {
      setEnding(false);
    }
  }

  return (
    <div className="space-y-6">
      <BackButton href="/super-admin/schools" />

      {err && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{err}</p>}

      {grantLoading ? (
        <p className="text-sm text-slate-400 text-center py-10">Loading…</p>
      ) : !grant ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-white p-10 text-center">
          <p className="text-sm font-medium text-slate-500">This session is not currently active</p>
          <p className="text-xs text-slate-400 mt-1">It may have expired, ended, or belong to a different account.</p>
        </div>
      ) : (
        <>
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-amber-900">Privileged tenant access — {grant.schoolName ?? 'Unknown school'}</p>
              <p className="text-xs text-amber-700 mt-0.5">{grant.reason}</p>
              <p className="text-xs text-amber-700 mt-0.5">
                Scopes: {grant.scopes.map((s) => PRIVILEGED_ACCESS_SCOPE_LABELS[s]).join(', ')} · Expires in {formatRemaining(grant.expiresAt)}
              </p>
            </div>
            <button
              onClick={endSession}
              disabled={ending}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-900 text-amber-50 hover:bg-amber-800 disabled:opacity-50 shrink-0"
            >
              {ending ? '…' : 'End session'}
            </button>
          </div>

          {grant.scopes.includes('SCHOOL_AGGREGATES') && (
            <section>
              <h2 className="text-sm font-semibold text-slate-600 mb-3">School aggregates</h2>
              {!overview ? (
                <p className="text-sm text-slate-400 text-center py-6">Loading…</p>
              ) : (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    <StatCard label="Total users" value={overview.users.total} />
                    <StatCard label="Active users" value={overview.users.active} accent="text-emerald-600" />
                    <StatCard label="Classes" value={overview.academic.classCount} />
                    <StatCard label="Subjects" value={overview.academic.subjectCount} />
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                    <StatCard label="Daily active" value={overview.engagement.dau} />
                    <StatCard label="Weekly active" value={overview.engagement.wau} />
                    <StatCard label="Monthly active" value={overview.engagement.mau} />
                  </div>
                </div>
              )}
            </section>
          )}

          {grant.scopes.includes('STUDENT_RECORDS') && (
            <section>
              <h2 className="text-sm font-semibold text-slate-600 mb-3">Student records</h2>
              {!students ? (
                <p className="text-sm text-slate-400 text-center py-6">Loading…</p>
              ) : students.length === 0 ? (
                <p className="text-sm text-slate-400">No active students.</p>
              ) : (
                <div className="bg-white border border-slate-200 rounded-xl overflow-hidden overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr>
                        <th className="text-left px-4 py-2 font-medium text-slate-500 text-xs">Admission No</th>
                        <th className="text-left px-4 py-2 font-medium text-slate-500 text-xs">Name</th>
                        <th className="text-left px-4 py-2 font-medium text-slate-500 text-xs">Class</th>
                        <th className="text-left px-4 py-2 font-medium text-slate-500 text-xs">Gender</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {students.map((s) => (
                        <tr key={s.id}>
                          <td className="px-4 py-2 text-slate-700">{s.admission_no}</td>
                          <td className="px-4 py-2 text-slate-700">{s.user?.full_name ?? '—'}</td>
                          <td className="px-4 py-2 text-slate-600">{s.class ? `${s.class.name} (Grade ${s.class.grade_level})` : '—'}</td>
                          <td className="px-4 py-2 text-slate-600">{s.gender ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {grant.scopes.includes('ACADEMIC_DATA') && (
            <section>
              <h2 className="text-sm font-semibold text-slate-600 mb-3">Academic data</h2>
              {!assessments ? (
                <p className="text-sm text-slate-400 text-center py-6">Loading…</p>
              ) : assessments.length === 0 ? (
                <p className="text-sm text-slate-400">No assessments recorded.</p>
              ) : (
                <div className="bg-white border border-slate-200 rounded-xl overflow-hidden overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr>
                        <th className="text-left px-4 py-2 font-medium text-slate-500 text-xs">Name</th>
                        <th className="text-left px-4 py-2 font-medium text-slate-500 text-xs">Class</th>
                        <th className="text-left px-4 py-2 font-medium text-slate-500 text-xs">Subject</th>
                        <th className="text-left px-4 py-2 font-medium text-slate-500 text-xs">Term</th>
                        <th className="text-right px-4 py-2 font-medium text-slate-500 text-xs">Max score</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {assessments.map((a) => (
                        <tr key={a.id}>
                          <td className="px-4 py-2 text-slate-700">{a.name}</td>
                          <td className="px-4 py-2 text-slate-600">{a.class?.name ?? '—'}</td>
                          <td className="px-4 py-2 text-slate-600">{a.subject?.name ?? '—'}</td>
                          <td className="px-4 py-2 text-slate-600">{a.term?.name ?? '—'}</td>
                          <td className="px-4 py-2 text-right text-slate-700">{a.max_marks}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {grant.scopes.includes('ATTENDANCE') && (
            <section>
              <h2 className="text-sm font-semibold text-slate-600 mb-3">Attendance</h2>
              {!attendance ? (
                <p className="text-sm text-slate-400 text-center py-6">Loading…</p>
              ) : attendance.length === 0 ? (
                <p className="text-sm text-slate-400">No attendance records.</p>
              ) : (
                <div className="bg-white border border-slate-200 rounded-xl overflow-hidden overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr>
                        <th className="text-left px-4 py-2 font-medium text-slate-500 text-xs">Date</th>
                        <th className="text-left px-4 py-2 font-medium text-slate-500 text-xs">Student</th>
                        <th className="text-left px-4 py-2 font-medium text-slate-500 text-xs">Class</th>
                        <th className="text-left px-4 py-2 font-medium text-slate-500 text-xs">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {attendance.map((a) => (
                        <tr key={a.id}>
                          <td className="px-4 py-2 text-slate-500 text-xs whitespace-nowrap">{a.date}</td>
                          <td className="px-4 py-2 text-slate-700">{a.student?.user?.full_name ?? '—'}</td>
                          <td className="px-4 py-2 text-slate-600">{a.class?.name ?? '—'}</td>
                          <td className="px-4 py-2 text-slate-600">{a.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {grant.scopes.includes('FINANCIAL_DATA') && (
            <section>
              <h2 className="text-sm font-semibold text-slate-600 mb-3">Financials</h2>
              {!financials ? (
                <p className="text-sm text-slate-400 text-center py-6">Loading…</p>
              ) : financials.length === 0 ? (
                <p className="text-sm text-slate-400">No fee balances recorded.</p>
              ) : (
                <div className="bg-white border border-slate-200 rounded-xl overflow-hidden overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr>
                        <th className="text-left px-4 py-2 font-medium text-slate-500 text-xs">Student</th>
                        <th className="text-left px-4 py-2 font-medium text-slate-500 text-xs">Term</th>
                        <th className="text-right px-4 py-2 font-medium text-slate-500 text-xs">Due</th>
                        <th className="text-right px-4 py-2 font-medium text-slate-500 text-xs">Paid</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {financials.map((f) => (
                        <tr key={f.id}>
                          <td className="px-4 py-2 text-slate-700">{f.student?.user?.full_name ?? '—'}</td>
                          <td className="px-4 py-2 text-slate-600">{f.term?.name ?? '—'}</td>
                          <td className="px-4 py-2 text-right text-slate-700">{f.currency} {Number(f.amount_due).toLocaleString()}</td>
                          <td className="px-4 py-2 text-right text-emerald-700">{f.currency} {Number(f.amount_paid).toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {grant.scopes.includes('DOCUMENTS') && (
            <section>
              <h2 className="text-sm font-semibold text-slate-600 mb-3">Documents</h2>
              {!documents ? (
                <p className="text-sm text-slate-400 text-center py-6">Loading…</p>
              ) : documents.length === 0 ? (
                <p className="text-sm text-slate-400">No documents uploaded.</p>
              ) : (
                <div className="bg-white border border-slate-200 rounded-xl overflow-hidden overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr>
                        <th className="text-left px-4 py-2 font-medium text-slate-500 text-xs">Title</th>
                        <th className="text-left px-4 py-2 font-medium text-slate-500 text-xs">Uploaded by</th>
                        <th className="text-left px-4 py-2 font-medium text-slate-500 text-xs">Date</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {documents.map((d) => (
                        <tr key={d.id}>
                          <td className="px-4 py-2 text-slate-700">
                            <a href={d.file_url} target="_blank" rel="noreferrer" className="text-violet-600 hover:underline">
                              {d.title}
                            </a>
                          </td>
                          <td className="px-4 py-2 text-slate-600">{d.uploader?.full_name ?? '—'}</td>
                          <td className="px-4 py-2 text-slate-500 text-xs whitespace-nowrap">{new Date(d.created_at).toLocaleDateString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {grant.scopes.includes('COMMUNICATION') && (
            <section>
              <h2 className="text-sm font-semibold text-slate-600 mb-3">Communication</h2>
              <p className="text-xs text-slate-400 mb-3">Metadata only — message content is never exposed through this scope.</p>
              {!conversations ? (
                <p className="text-sm text-slate-400 text-center py-6">Loading…</p>
              ) : conversations.length === 0 ? (
                <p className="text-sm text-slate-400">No conversations.</p>
              ) : (
                <div className="bg-white border border-slate-200 rounded-xl overflow-hidden overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr>
                        <th className="text-left px-4 py-2 font-medium text-slate-500 text-xs">Parent</th>
                        <th className="text-left px-4 py-2 font-medium text-slate-500 text-xs">Teacher</th>
                        <th className="text-left px-4 py-2 font-medium text-slate-500 text-xs">Student</th>
                        <th className="text-left px-4 py-2 font-medium text-slate-500 text-xs">Last message</th>
                        <th className="text-left px-4 py-2 font-medium text-slate-500 text-xs">Flagged</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {conversations.map((c) => (
                        <tr key={c.id}>
                          <td className="px-4 py-2 text-slate-700">{c.parent?.full_name ?? '—'}</td>
                          <td className="px-4 py-2 text-slate-700">{c.teacher?.full_name ?? '—'}</td>
                          <td className="px-4 py-2 text-slate-600">{c.student?.user?.full_name ?? '—'}</td>
                          <td className="px-4 py-2 text-slate-500 text-xs whitespace-nowrap">
                            {c.last_message_at ? new Date(c.last_message_at).toLocaleString() : '—'}
                          </td>
                          <td className="px-4 py-2">
                            {c.is_flagged ? (
                              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-rose-50 text-rose-700">Flagged</span>
                            ) : (
                              <span className="text-xs text-slate-400">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
