'use client';

import { Suspense } from 'react';
import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { EmailLoginInput } from '@school-manager/types';

type Tab = 'email' | 'phone';

const ROLE_HOME: Record<string, string> = {
  ADMIN: '/admin',
  TEACHER: '/teacher',
  STUDENT: '/student',
  PARENT: '/parent',
};

function LoginPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<Tab>('email');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const supabase = createClient();

  async function handleEmailLogin(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    const result = EmailLoginInput.safeParse({ email, password });
    if (!result.success) {
      setError(result.error.issues[0]?.message ?? 'Invalid input');
      return;
    }

    setLoading(true);
    const { data: { user }, error: authError } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);

    if (authError) {
      setError(authError.message);
      return;
    }

    const { data: userRow } = await supabase
      .from('users')
      .select('role')
      .eq('auth_id', user!.id)
      .maybeSingle();

    const role = userRow?.role as string | undefined;
    const next = searchParams.get('next');
    const destination = next || (role && ROLE_HOME[role]) || '/';

    router.refresh();
    router.push(destination);
  }

  async function handleSendOtp(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!phone.match(/^\+\d{7,15}$/)) {
      setError('Phone must be E.164 format e.g. +254700000000');
      return;
    }
    setLoading(true);
    const { error: authError } = await supabase.auth.signInWithOtp({ phone });
    setLoading(false);
    if (authError) { setError(authError.message); return; }
    setOtpSent(true);
  }

  async function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    const { data: { user }, error: authError } = await supabase.auth.verifyOtp({
      phone,
      token: otp,
      type: 'sms',
    });
    setLoading(false);
    if (authError) { setError(authError.message); return; }

    const { data: userRow } = await supabase
      .from('users')
      .select('role')
      .eq('auth_id', user!.id)
      .maybeSingle();

    const role = userRow?.role as string | undefined;
    const next = searchParams.get('next');
    const destination = next || (role && ROLE_HOME[role]) || '/';

    router.refresh();
    router.push(destination);
  }

  return (
    <div className="bg-white p-8 rounded-xl shadow-sm border border-slate-200">
      <h1 className="text-2xl font-semibold mb-1">Sign in</h1>
      <p className="text-sm text-slate-500 mb-6">
        Use the credentials your school admin gave you.
      </p>

      <div className="flex rounded-lg border border-slate-200 p-1 mb-6 gap-1">
        {(['email', 'phone'] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => { setTab(t); setError(''); setOtpSent(false); }}
            className={`flex-1 py-1.5 text-sm rounded-md transition-colors ${
              tab === t ? 'bg-slate-900 text-white' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {t === 'email' ? 'Email' : 'Phone (OTP)'}
          </button>
        ))}
      </div>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2 mb-4">
          {error}
        </p>
      )}

      {tab === 'email' && (
        <form onSubmit={handleEmailLogin} className="space-y-4">
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
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-slate-700">
              Password
            </label>
            <input
              id="password" type="password" required value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2
                         text-sm focus:border-slate-500 focus:outline-none"
            />
          </div>
          <a href="/reset-password" className="block text-sm text-slate-500 hover:text-slate-900">
            Forgot password?
          </a>
          <button
            type="submit" disabled={loading}
            className="w-full bg-slate-900 text-white py-2 rounded-md text-sm font-medium
                       hover:bg-slate-700 disabled:opacity-50 transition-colors"
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      )}

      {tab === 'phone' && !otpSent && (
        <form onSubmit={handleSendOtp} className="space-y-4">
          <div>
            <label htmlFor="phone" className="block text-sm font-medium text-slate-700">
              Phone number
            </label>
            <input
              id="phone" type="tel" required value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+254700000000"
              className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2
                         text-sm focus:border-slate-500 focus:outline-none"
            />
            <p className="mt-1 text-xs text-slate-400">E.164 format e.g. +254700000000</p>
          </div>
          <button
            type="submit" disabled={loading}
            className="w-full bg-slate-900 text-white py-2 rounded-md text-sm font-medium
                       hover:bg-slate-700 disabled:opacity-50 transition-colors"
          >
            {loading ? 'Sending…' : 'Send OTP'}
          </button>
        </form>
      )}

      {tab === 'phone' && otpSent && (
        <form onSubmit={handleVerifyOtp} className="space-y-4">
          <p className="text-sm text-slate-600">
            Code sent to <strong>{phone}</strong>.
          </p>
          <div>
            <label htmlFor="otp" className="block text-sm font-medium text-slate-700">
              6-digit code
            </label>
            <input
              id="otp" type="text" inputMode="numeric" maxLength={6} required value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
              className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2
                         text-sm tracking-widest text-center focus:border-slate-500 focus:outline-none"
            />
          </div>
          <button
            type="submit" disabled={loading}
            className="w-full bg-slate-900 text-white py-2 rounded-md text-sm font-medium
                       hover:bg-slate-700 disabled:opacity-50 transition-colors"
          >
            {loading ? 'Verifying…' : 'Verify & sign in'}
          </button>
          <button type="button" onClick={() => { setOtpSent(false); setOtp(''); }}
            className="w-full text-sm text-slate-500 hover:text-slate-900">
            ← Change number
          </button>
        </form>
      )}
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginPageInner />
    </Suspense>
  );
}
