'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

// Skip static prerendering: see (auth)/reset-password/page.tsx for rationale.
export const dynamic = 'force-dynamic';

export default function SafetyTipPage() {
  const supabase = createClient();
  const [message, setMessage] = useState('');
  const [schoolCode, setSchoolCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true); setErr('');

    // Look up school by code (school subdomain or short code stored in schools.code)
    const { data: school } = await supabase
      .from('schools')
      .select('id')
      .eq('id', schoolCode.trim()) // using school ID directly for simplicity
      .maybeSingle();

    if (!school) { setErr('School not found. Please check the code.'); setSubmitting(false); return; }

    const { error } = await supabase.from('safety_tips').insert({
      school_id: school.id,
      message: message.trim(),
    });

    if (error) { setErr('Failed to submit. Please try again.'); setSubmitting(false); return; }
    setDone(true); setSubmitting(false);
  }

  if (done) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-2xl p-8 text-center shadow-sm">
          <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4 text-3xl">✓</div>
          <h1 className="text-xl font-semibold text-slate-800">Report submitted</h1>
          <p className="text-slate-500 mt-2 text-sm">Your anonymous report has been sent to the school&apos;s designated safety staff. Thank you for speaking up.</p>
          <button onClick={() => { setDone(false); setMessage(''); setSchoolCode(''); }}
            className="mt-6 px-5 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-700">
            Submit another report
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-2xl p-8 shadow-sm space-y-6">
        <div>
          <div className="w-12 h-12 bg-amber-100 rounded-xl flex items-center justify-center text-2xl mb-4">🛡</div>
          <h1 className="text-xl font-semibold text-slate-800">Anonymous safety report</h1>
          <p className="text-sm text-slate-500 mt-1">
            Report bullying, safety concerns, or anything that worries you. Your identity is never recorded.
            This goes directly to your school&apos;s head teacher and counsellor only.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {err && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{err}</p>}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">School ID</label>
            <input value={schoolCode} onChange={(e) => setSchoolCode(e.target.value)} required
              placeholder="Ask your teacher for the school ID"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">What would you like to report?</label>
            <textarea value={message} onChange={(e) => setMessage(e.target.value)} required
              rows={5} minLength={10} maxLength={2000}
              placeholder="Describe what happened or what you are concerned about…"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm resize-none" />
          </div>
          <button type="submit" disabled={submitting}
            className="w-full py-2.5 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-700 disabled:opacity-50">
            {submitting ? 'Submitting…' : 'Submit anonymously'}
          </button>
        </form>

        <p className="text-xs text-slate-400 text-center">No IP address or personal data is stored with this report.</p>
      </div>
    </div>
  );
}
