"use client";

import dynamic from "next/dynamic";

const EstimatorApp = dynamic(() => import("./EstimatorApp"), {
  ssr: false,
  loading: () => <p className="text-slate-500 text-center py-10">Loading application...</p>
});

export default function ClientEstimatorApp() {
  return <EstimatorApp />;
}
