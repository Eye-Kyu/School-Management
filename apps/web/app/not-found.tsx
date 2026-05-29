import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full text-center space-y-4">
        <p className="text-8xl font-bold text-slate-200">404</p>
        <h1 className="text-xl font-semibold text-slate-800">Page not found</h1>
        <p className="text-sm text-slate-500">
          The page you&apos;re looking for doesn&apos;t exist or you don&apos;t have access to it.
        </p>
        <Link href="/"
          className="inline-block px-5 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-700">
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}
