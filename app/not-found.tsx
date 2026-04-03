import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-slate-50 text-slate-800 p-4">
      <h2 className="text-4xl font-bold mb-4">404 - Page Not Found</h2>
      <p className="text-lg mb-8 text-slate-600">The page you are looking for does not exist.</p>
      <Link 
        href="/" 
        className="bg-emerald-600 hover:bg-emerald-500 text-white px-6 py-3 rounded-lg font-bold shadow-md transition"
      >
        Return Home
      </Link>
    </div>
  );
}
