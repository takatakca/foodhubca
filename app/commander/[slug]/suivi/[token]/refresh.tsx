'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/** Re-reads the tracking page every few seconds (server data only; nothing is kept in the browser). */
export default function AutoRefresh({ seconds }: { seconds: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = window.setInterval(() => router.refresh(), seconds * 1000);
    return () => window.clearInterval(id);
  }, [router, seconds]);
  return null;
}
