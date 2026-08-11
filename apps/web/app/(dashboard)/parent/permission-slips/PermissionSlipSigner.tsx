'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import posthog from 'posthog-js';

type Slip = {
  id: string; title: string; description: string | null;
  audience: string; target_class_id: string | null;
  response_deadline: string | null; one_time_code: string;
};
type Student = { id: string; name: string; classId: string };

export default function PermissionSlipSigner({
  slips, students, signedSet: initialSigned, parentUserId,
}: {
  slips: Slip[];
  students: Student[];
  signedSet: string[];
  parentUserId: string;
}) {
  const supabase = createClient();
  const [signed, setSigned] = useState(new Set(initialSigned));
  const [codeInputs, setCodeInputs] = useState<Record<string, string>>({});
  const [selectedStudent, setSelectedStudent] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});

  // Filter slips relevant to this parent's children
  const relevantSlips = slips.filter((s) => {
    if (s.audience === 'SCHOOL_WIDE') return true;
    if (s.audience === 'CLASS') return students.some((st) => st.classId === s.target_class_id);
    return true;
  });

  // Get students eligible for each slip
  function eligibleStudents(slip: Slip) {
    if (slip.audience === 'CLASS') return students.filter((st) => st.classId === slip.target_class_id);
    return students;
  }

  async function handleSign(slip: Slip) {
    const studentId = selectedStudent[slip.id] ?? students[0]?.id;
    if (!studentId) return;

    const key = `${slip.id}:${studentId}`;
    const enteredCode = (codeInputs[slip.id] ?? '').trim().toUpperCase();

    if (enteredCode !== slip.one_time_code.toUpperCase()) {
      setErrors((p) => ({ ...p, [slip.id]: 'Incorrect code. Please check with your school.' }));
      return;
    }

    setLoading((p) => ({ ...p, [slip.id]: true }));
    setErrors((p) => ({ ...p, [slip.id]: '' }));

    const { data: userRow } = await supabase.from('users').select('school_id').maybeSingle();
    const { error } = await supabase.from('permission_slip_responses').upsert({
      school_id: userRow?.school_id,
      slip_id: slip.id,
      student_id: studentId,
      parent_user_id: parentUserId,
      signed_at: new Date().toISOString(),
    }, { onConflict: 'slip_id,student_id' });

    if (error) {
      setErrors((p) => ({ ...p, [slip.id]: error.message }));
    } else {
      posthog.capture('permission_slip_signed', { audience: slip.audience });
      setSigned((p) => new Set([...p, key]));
      setCodeInputs((p) => ({ ...p, [slip.id]: '' }));
    }
    setLoading((p) => ({ ...p, [slip.id]: false }));
  }

  if (relevantSlips.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 bg-white p-10 text-center text-sm text-slate-400">
        No permission slips available at the moment.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {relevantSlips.map((slip) => {
        const eligible = eligibleStudents(slip);
        const studentId = selectedStudent[slip.id] ?? eligible[0]?.id ?? '';
        const isSigned = signed.has(`${slip.id}:${studentId}`);
        const isExpired = slip.response_deadline && new Date(slip.response_deadline) < new Date();

        return (
          <div key={slip.id} className={`bg-white border rounded-xl p-5 space-y-3 ${isSigned ? 'border-emerald-200' : 'border-slate-200'}`}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold text-slate-800">{slip.title}</p>
                {slip.description && <p className="text-sm text-slate-500 mt-0.5">{slip.description}</p>}
                {slip.response_deadline && (
                  <p className={`text-xs mt-1 ${isExpired ? 'text-rose-500' : 'text-slate-400'}`}>
                    {isExpired ? 'Deadline passed: ' : 'Deadline: '}{slip.response_deadline}
                  </p>
                )}
              </div>
              {isSigned && (
                <span className="shrink-0 text-xs bg-emerald-100 text-emerald-700 font-semibold px-2.5 py-1 rounded-full">
                  ✓ Signed
                </span>
              )}
            </div>

            {!isSigned && !isExpired && (
              <div className="space-y-3 border-t border-slate-100 pt-3">
                {eligible.length > 1 && (
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Signing for</label>
                    <select
                      value={studentId}
                      onChange={(e) => setSelectedStudent((p) => ({ ...p, [slip.id]: e.target.value }))}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    >
                      {eligible.map((s) => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  </div>
                )}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Enter the code provided by the school
                  </label>
                  <div className="flex gap-2">
                    <input
                      value={codeInputs[slip.id] ?? ''}
                      onChange={(e) => setCodeInputs((p) => ({ ...p, [slip.id]: e.target.value.toUpperCase() }))}
                      maxLength={8}
                      placeholder="e.g. AB3XY7"
                      className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm font-mono tracking-widest uppercase"
                    />
                    <button
                      onClick={() => handleSign(slip)}
                      disabled={loading[slip.id] || !codeInputs[slip.id]?.trim()}
                      className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-700 disabled:opacity-50"
                    >
                      {loading[slip.id] ? 'Signing…' : 'Sign'}
                    </button>
                  </div>
                  {errors[slip.id] && (
                    <p className="text-xs text-red-600 mt-1">{errors[slip.id]}</p>
                  )}
                </div>
              </div>
            )}

            {isExpired && !isSigned && (
              <p className="text-sm text-slate-400 border-t border-slate-100 pt-3">
                The deadline for this slip has passed.
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
