"use client";

import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 text-slate-800">
      <h2 className="text-3xl font-bold mb-4">404 - Not Found</h2>
      <p className="mb-8 text-slate-600 text-lg">Could not find requested resource</p>
      <Link
        href="/"
        className="px-6 py-3 bg-emerald-600 text-white font-bold rounded-lg hover:bg-emerald-500 transition-all shadow-md"
      >
        Return Home
      </Link>
    </div>
  );
}
