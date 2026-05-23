'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export default function ResetPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const supabase = createClient();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    const { error: authError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/update-password`,
    });

    setLoading(false);

    if (authError) {
      setError(authError.message);
      return;
    }

    setSent(true);
  }

  if (sent) {
    return (
      <div className="bg-white p-8 rounded-xl shadow-sm border border-slate-200 text-center space-y-3">
        <div className="text-4xl">📬</div>
        <h1 className="text-xl font-semibold">Check your email</h1>
        <p className="text-sm text-slate-500">
          We sent a reset link to <strong>{email}</strong>. Click the link in the email to
          set a new password.
        </p>
        <a href="/login" className="block text-sm text-slate-500 hover:text-slate-900 pt-2">
          ← Back to sign in
        </a>
      </div>
    );
  }

  return (
    <div className="bg-white p-8 rounded-xl shadow-sm border border-slate-200">
      <h1 className="text-2xl font-semibold mb-1">Reset password</h1>
      <p className="text-sm text-slate-500 mb-6">
        Enter your email and we'll send a reset link.
      </p>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2 mb-4">
          {error}
        </p>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-slate-700">
            Email
          </label>
          <input
            id="email" type="email" required value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@school.tld"
            className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2
                       text-sm focus:border-slate-500 focus:outline-none"
          />
        </div>
        <button
          type="submit" disabled={loading}
          className="w-full bg-slate-900 text-white py-2 rounded-md text-sm font-medium
                     hover:bg-slate-700 disabled:opacity-50 transition-colors"
        >
          {loading ? 'Sending…' : 'Send reset link'}
        </button>
        <a href="/login" className="block text-sm text-center text-slate-500 hover:text-slate-900">
          ← Back to sign in
        </a>
      </form>
    </div>
  );
}
