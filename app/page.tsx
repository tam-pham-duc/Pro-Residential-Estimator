"use client";

import dynamic from "next/dynamic";

const EstimatorApp = dynamic(() => import("@/components/EstimatorApp"), {
  ssr: false,
  loading: () => <p className="text-slate-500">Loading application...</p>
});

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-4 md:p-24 bg-gray-100">
      <EstimatorApp />
    </main>
  );
}
