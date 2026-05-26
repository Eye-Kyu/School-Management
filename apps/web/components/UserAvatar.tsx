'use client';

const COLORS = [
  'bg-violet-500',
  'bg-blue-500',
  'bg-emerald-500',
  'bg-amber-500',
  'bg-rose-500',
  'bg-cyan-500',
  'bg-indigo-500',
  'bg-teal-500',
];

export default function UserAvatar({
  name,
  avatarUrl,
  size = 32,
}: {
  name: string;
  avatarUrl?: string | null;
  size?: number;
}) {
  const initials = name
    .trim()
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const bg = COLORS[name.charCodeAt(0) % COLORS.length];
  const px = `${size}px`;
  const fontSize = Math.round(size * 0.38);

  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={name}
        className="rounded-full object-cover shrink-0"
        style={{ width: px, height: px }}
      />
    );
  }

  return (
    <div
      className={`${bg} rounded-full flex items-center justify-center text-white font-semibold shrink-0`}
      style={{ width: px, height: px, fontSize }}
    >
      {initials}
    </div>
  );
}
