'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export default function UpdatePasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const supabase = createClient();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);
    const { error: authError } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (authError) {
      setError(authError.message);
      return;
    }

    router.push('/');
  }

  return (
    <div className="bg-white p-8 rounded-xl shadow-sm border border-slate-200">
      <h1 className="text-2xl font-semibold mb-1">Set new password</h1>
      <p className="text-sm text-slate-500 mb-6">Choose a password you haven't used before.</p>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2 mb-4">
          {error}
        </p>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="password" className="block text-sm font-medium text-slate-700">
            New password
          </label>
          <input
            id="password" type="password" required minLength={8} value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2
                       text-sm focus:border-slate-500 focus:outline-none"
          />
        </div>
        <div>
          <label htmlFor="confirm" className="block text-sm font-medium text-slate-700">
            Confirm password
          </label>
          <input
            id="confirm" type="password" required value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2
                       text-sm focus:border-slate-500 focus:outline-none"
          />
        </div>
        <button
          type="submit" disabled={loading}
          className="w-full bg-slate-900 text-white py-2 rounded-md text-sm font-medium
                     hover:bg-slate-700 disabled:opacity-50 transition-colors"
        >
          {loading ? 'Saving…' : 'Set password'}
        </button>
      </form>
    </div>
  );
}
