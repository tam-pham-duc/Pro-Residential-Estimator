"use client";

import dynamic from 'next/dynamic';

const EstimatorApp = dynamic(() => import('@/components/EstimatorApp'), {
  ssr: false,
});

export default function Home() {
  return <EstimatorApp />;
}
