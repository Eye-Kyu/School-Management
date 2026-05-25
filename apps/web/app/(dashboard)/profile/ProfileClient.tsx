'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { createClient } from '@/lib/supabase/client';

export default function ProfileClient({
  fullName: initialFullName,
  email,
  phone: initialPhone,
  role,
}: {
  fullName: string;
  email: string;
  phone: string;
  role: string;
}) {
  const router = useRouter();

  // Profile info form
  const [fullName, setFullName] = useState(initialFullName);
  const [phone, setPhone] = useState(initialPhone);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileSuccess, setProfileSuccess] = useState(false);
  const [profileError, setProfileError] = useState('');

  // Password form
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordSuccess, setPasswordSuccess] = useState(false);
  const [passwordError, setPasswordError] = useState('');

  async function handleProfileSave(e: React.FormEvent) {
    e.preventDefault();
    setSavingProfile(true);
    setProfileSuccess(false);
    setProfileError('');
    try {
      await apiFetch('/users/me', {
        method: 'PATCH',
        body: JSON.stringify({ fullName: fullName.trim(), phone: phone.trim() || undefined }),
      });
      setProfileSuccess(true);
      router.refresh();
      setTimeout(() => setProfileSuccess(false), 4000);
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setSavingProfile(false);
    }
  }

  async function handlePasswordChange(e: React.FormEvent) {
    e.preventDefault();
    setPasswordError('');
    setPasswordSuccess(false);
    if (newPassword.length < 6) {
      setPasswordError('Password must be at least 6 characters');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('Passwords do not match');
      return;
    }
    setSavingPassword(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      setPasswordSuccess(true);
      setNewPassword('');
      setConfirmPassword('');
      setTimeout(() => setPasswordSuccess(false), 4000);
    } catch (err: any) {
      setPasswordError(err?.message ?? 'Password update failed');
    } finally {
      setSavingPassword(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Profile info */}
      <form onSubmit={handleProfileSave} className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-base font-semibold text-slate-800">Personal information</h2>
          {role && (
            <span className="text-xs font-medium uppercase tracking-wide bg-slate-100 text-slate-500 px-2 py-0.5 rounded">
              {role.toLowerCase()}
            </span>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Full name</label>
          <input
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            required
            maxLength={100}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
          <input
            value={email}
            readOnly
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-slate-50 text-slate-500 cursor-not-allowed"
          />
          <p className="text-xs text-slate-400 mt-1">Email cannot be changed here. Contact your administrator.</p>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Phone</label>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+254..."
            maxLength={20}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
          />
        </div>

        {profileError && <p className="text-sm text-rose-600">{profileError}</p>}
        {profileSuccess && <p className="text-sm text-emerald-600">Profile updated successfully.</p>}

        <button
          type="submit"
          disabled={savingProfile}
          className="px-5 py-2 rounded-lg bg-slate-800 text-white text-sm font-medium hover:bg-slate-700 disabled:opacity-50 transition-colors"
        >
          {savingProfile ? 'Saving…' : 'Save changes'}
        </button>
      </form>

      {/* Password */}
      <form onSubmit={handlePasswordChange} className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <h2 className="text-base font-semibold text-slate-800 mb-1">Change password</h2>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">New password</label>
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
            minLength={6}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Confirm new password</label>
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
          />
        </div>

        {passwordError && <p className="text-sm text-rose-600">{passwordError}</p>}
        {passwordSuccess && <p className="text-sm text-emerald-600">Password changed. Sign out and back in to confirm.</p>}

        <button
          type="submit"
          disabled={savingPassword}
          className="px-5 py-2 rounded-lg bg-slate-800 text-white text-sm font-medium hover:bg-slate-700 disabled:opacity-50 transition-colors"
        >
          {savingPassword ? 'Updating…' : 'Change password'}
        </button>
      </form>
    </div>
  );
}
