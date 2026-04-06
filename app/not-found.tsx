import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-slate-50 text-slate-800 p-4">
      <h2 className="text-4xl font-bold mb-4">404 - Page Not Found</h2>
      <p className="text-lg text-slate-600 mb-8">The page you are looking for does not exist.</p>
      <Link 
        href="/"
        className="px-6 py-3 bg-emerald-600 text-white rounded-lg hover:bg-emerald-500 font-bold shadow-md transition"
      >
        Return Home
      </Link>
    </div>
  );
}
