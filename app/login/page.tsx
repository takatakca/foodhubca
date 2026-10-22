import { redirect } from 'next/navigation';
import { firstRunNeeded, safeNext } from '@/lib/foodhub/identity/otp';
import { googleSignInEnabled } from '@/lib/foodhub/identity/google';
import { getViewer } from '@/lib/foodhub/viewer';
import { liveCloverApps } from '@/lib/foodhub/clover-apps';
import { LoginView, type GoogleNotice } from './login-view';

export const dynamic = 'force-dynamic';

const GOOGLE_NOTICES = new Set<GoogleNotice>(['not_on_team', 'unverified', 'off', 'state', 'google', 'locked', 'disabled']);

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const q = await searchParams;
  const next = safeNext(q.next);
  if (await getViewer()) redirect(next);
  const firstRun = await firstRunNeeded().catch(() => false);
  const google = GOOGLE_NOTICES.has(q.google as GoogleNotice) ? (q.google as GoogleNotice) : null;
  return (
    <LoginView next={next} error={q.error ?? null} firstRun={firstRun} google={google}
      googleEnabled={googleSignInEnabled()}
      recovery={Boolean(process.env.DASHBOARD_PASSWORD)} cloverApps={liveCloverApps()}
      needsKey={firstRun && process.env.NODE_ENV === 'production' && !process.env.FOODHUB_OWNER_EMAIL && !process.env.FOODHUB_OWNER_PHONE} />
  );
}
