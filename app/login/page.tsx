import { redirect } from 'next/navigation';
import { firstRunNeeded, safeNext } from '@/lib/foodhub/identity/otp';
import { getViewer } from '@/lib/foodhub/viewer';
import { liveCloverApps } from '@/lib/foodhub/clover-apps';
import { LoginView } from './login-view';

export const dynamic = 'force-dynamic';

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const q = await searchParams;
  const next = safeNext(q.next);
  if (await getViewer()) redirect(next);
  const firstRun = await firstRunNeeded().catch(() => false);
  return (
    <LoginView next={next} error={q.error ?? null} firstRun={firstRun}
      recovery={Boolean(process.env.DASHBOARD_PASSWORD)} cloverApps={liveCloverApps()}
      needsKey={firstRun && process.env.NODE_ENV === 'production' && !process.env.FOODHUB_OWNER_EMAIL && !process.env.FOODHUB_OWNER_PHONE} />
  );
}
