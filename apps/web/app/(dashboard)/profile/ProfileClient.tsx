'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { createClient } from '@/lib/supabase/client';
import UserAvatar from '@/components/UserAvatar';

const DICEBEAR_PRESETS = [
  'https://api.dicebear.com/9.x/thumbs/svg?seed=Orion&backgroundColor=b6e3f4',
  'https://api.dicebear.com/9.x/thumbs/svg?seed=Mira&backgroundColor=d1d4f9',
  'https://api.dicebear.com/9.x/thumbs/svg?seed=Zephyr&backgroundColor=c0aede',
  'https://api.dicebear.com/9.x/thumbs/svg?seed=Kai&backgroundColor=ffd5dc',
  'https://api.dicebear.com/9.x/thumbs/svg?seed=Nova&backgroundColor=ffdfbf',
  'https://api.dicebear.com/9.x/thumbs/svg?seed=River&backgroundColor=c1f4c5',
  'https://api.dicebear.com/9.x/thumbs/svg?seed=Sage&backgroundColor=b6e3f4',
  'https://api.dicebear.com/9.x/thumbs/svg?seed=Atlas&backgroundColor=ffd5dc',
];

export default function ProfileClient({
  fullName: initialFullName,
  email,
  phone: initialPhone,
  role,
  avatarUrl: initialAvatarUrl,
}: {
  fullName: string;
  email: string;
  phone: string;
  role: string;
  avatarUrl: string | null;
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Avatar state
  const [avatarUrl, setAvatarUrl] = useState<string | null>(initialAvatarUrl);
  const [avatarSaving, setAvatarSaving] = useState(false);
  const [avatarError, setAvatarError] = useState('');
  const [showPresets, setShowPresets] = useState(false);

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

  async function saveAvatar(url: string) {
    setAvatarSaving(true);
    setAvatarError('');
    try {
      await apiFetch('/users/me', {
        method: 'PATCH',
        body: JSON.stringify({ fullName: fullName.trim(), avatarUrl: url }),
      });
      setAvatarUrl(url);
      setShowPresets(false);
      router.refresh();
    } catch {
      setAvatarError('Failed to save avatar. Please try again.');
    } finally {
      setAvatarSaving(false);
    }
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setAvatarError('Photo must be under 2 MB.');
      return;
    }

    setAvatarSaving(true);
    setAvatarError('');
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Determine mime type and extension
      const mimeToExt: Record<string, string> = {
        'image/jpeg': 'jpg',
        'image/png': 'png',
        'image/webp': 'webp',
      };
      const ext = mimeToExt[file.type] ?? 'jpg';
      const contentType = file.type || 'image/jpeg';
      // Always overwrite the same slot so old files don't accumulate
      const path = `${user.id}/avatar.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(path, file, { upsert: true, contentType });

      if (uploadError) {
        // Bucket not found means the migration hasn't been run yet
        if (uploadError.message.includes('Bucket not found') || uploadError.message.includes('bucket')) {
          throw new Error('Avatar storage is not configured. Please run the avatar migration in Supabase SQL editor first.');
        }
        throw uploadError;
      }

      const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(path);
      // Bust cache so the browser fetches the new image
      await saveAvatar(`${publicUrl}?t=${Date.now()}`);
    } catch (err: any) {
      setAvatarError(err?.message ?? 'Upload failed.');
      setAvatarSaving(false);
    }
    // reset file input so the same file can be re-selected
    e.target.value = '';
  }

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
      {/* Avatar section */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <h2 className="text-base font-semibold text-slate-800">Profile picture</h2>

        <div className="flex items-center gap-4">
          <UserAvatar name={fullName || 'U'} avatarUrl={avatarUrl} size={72} />
          <div className="space-y-1">
            <p className="text-sm font-medium text-slate-700">{fullName || 'Your name'}</p>
            {role && (
              <span className="text-xs font-medium uppercase tracking-wide bg-slate-100 text-slate-500 px-2 py-0.5 rounded">
                {role.toLowerCase()}
              </span>
            )}
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowPresets((v) => !v)}
                disabled={avatarSaving}
                className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors disabled:opacity-50"
              >
                {showPresets ? 'Hide presets' : 'Choose preset'}
              </button>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={avatarSaving}
                className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors disabled:opacity-50"
              >
                {avatarSaving ? 'Uploading…' : 'Upload photo'}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={handleFileUpload}
              />
            </div>
          </div>
        </div>

        {showPresets && (
          <div className="space-y-2">
            <p className="text-xs text-slate-500">Pick a preset avatar:</p>
            <div className="grid grid-cols-8 gap-2">
              {DICEBEAR_PRESETS.map((url) => (
                <button
                  key={url}
                  type="button"
                  onClick={() => saveAvatar(url)}
                  disabled={avatarSaving}
                  className={`rounded-full overflow-hidden border-2 transition-all hover:scale-110 ${
                    avatarUrl === url ? 'border-slate-800' : 'border-transparent'
                  }`}
                >
                  <img src={url} alt="preset" className="w-10 h-10" />
                </button>
              ))}
            </div>
          </div>
        )}

        {avatarError && <p className="text-sm text-rose-600">{avatarError}</p>}
      </div>

      {/* Profile info */}
      <form onSubmit={handleProfileSave} className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-base font-semibold text-slate-800">Personal information</h2>
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
