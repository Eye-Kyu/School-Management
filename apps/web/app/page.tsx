import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="max-w-md text-center space-y-6">
        <h1 className="text-4xl font-bold">School Manager</h1>
        <p className="text-slate-600">
          One platform for parents, students, teachers, and admins.
        </p>
        <p className="text-sm text-slate-500">v0.1 - foundation release</p>
        <Link
          href="/login"
          className="inline-block bg-slate-900 text-white px-6 py-3 rounded-lg
                     hover:bg-slate-700 transition-colors"
        >
          Sign in
        </Link>
      </div>
    </main>
  );
}
