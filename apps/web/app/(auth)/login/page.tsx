'use client';

import { Suspense } from 'react';
import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { apiFetch } from '@/lib/api';
import { EmailLoginInput } from '@school-manager/types';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

type Tab = 'email' | 'phone';

function Eye() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOff() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
      <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
      <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
      <line x1="2" x2="22" y1="2" y2="22" />
    </svg>
  );
}

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
  const [showPassword, setShowPassword] = useState(false);
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
      fetch(`${API_BASE}/auth/failed-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      }).catch(() => {});
      return;
    }

    apiFetch('/auth/events', { method: 'POST', body: JSON.stringify({ action: 'auth.login' }) }).catch(() => {});

    const { data: userRow } = await supabase
      .from('users')
      .select('role')
      .eq('auth_id', user!.id)
      .maybeSingle();

    const role = userRow?.role as string | undefined;
    const next = searchParams.get('next');
    const destination = next || (role && ROLE_HOME[role]) || '/';

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

    apiFetch('/auth/events', { method: 'POST', body: JSON.stringify({ action: 'auth.login' }) }).catch(() => {});

    const { data: userRow } = await supabase
      .from('users')
      .select('role')
      .eq('auth_id', user!.id)
      .maybeSingle();

    const role = userRow?.role as string | undefined;
    const next = searchParams.get('next');
    const destination = next || (role && ROLE_HOME[role]) || '/';

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
            <div className="relative mt-1">
              <input
                id="password" type={showPassword ? 'text' : 'password'} required value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="block w-full rounded-md border border-slate-300 px-3 py-2 pr-10
                           text-sm focus:border-slate-500 focus:outline-none"
              />
              <button type="button" tabIndex={-1} onClick={() => setShowPassword((v) => !v)}
                className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-400 hover:text-slate-600">
                {showPassword ? <EyeOff /> : <Eye />}
              </button>
            </div>
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
