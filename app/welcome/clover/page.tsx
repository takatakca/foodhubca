import type { Metadata } from 'next';
import { legalInfo } from '@/lib/foodhub/legal';
import { onboardingSteps } from '@/lib/foodhub/onboarding';
import { cloverApp } from '@/lib/foodhub/pos/clover-apps';
import { CLOVER_CONNECT_ERRORS, cloverWebUrl, cloverWelcome, type CloverConnectError } from '@/lib/foodhub/pos/clover-oauth';
import { can } from '@/lib/foodhub/session';
import { getViewer } from '@/lib/foodhub/viewer';
import { KeepProductNames } from '@/lib/i18n/client';
import { WelcomeView, type WelcomeData } from './welcome-view';

export const dynamic = 'force-dynamic';
// The ticket in the address must never leave in a Referer header; the page is not for search engines.
export const metadata: Metadata = { title: 'Bienvenue · Welcome — TAKATAK Food Hub', referrer: 'no-referrer', robots: { index: false, follow: false } };

// Public landing page after a merchant opens the "TAKATAK Food Hub" app from Clover (see clover-connect/callback).
// With the signed ticket (?t=…) it shows that merchant's own connection, read live: approved or waiting, what Food Hub
// read from its register, its App Market subscription, the 3 set-up steps and the "send a test order" check.
// Without a ticket it shows no merchant data at all. No sign-in needed; signed-in owners/managers also see their
// own set-up progress.
export default async function CloverWelcomePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const q = await searchParams;
  const ticket = typeof q.t === 'string' && q.t.length < 600 ? q.t : null;
  const [welcome, viewer] = await Promise.all([cloverWelcome(ticket), getViewer().catch(() => null)]);
  const info = legalInfo();

  let state: WelcomeData['state'];
  if (welcome) state = welcome.status === 'active' ? 'connected' : welcome.status;
  else if (q.status === 'connected' || q.status === 'pending') state = q.status;
  else if (q.status === 'error' || q.err || ticket) state = 'error'; // an expired / forged ticket lands here too
  else state = 'intro';
  const errCode = (q.err && q.err in CLOVER_CONNECT_ERRORS ? q.err : null) as CloverConnectError | null;
  // The AI phone and TAKATAK MEV apps land here too: the signed ticket says which app (the ?app= hint only names it when
  // there is no ticket).
  const named = (a: unknown): 'phone' | 'mev' | null => (a === 'phone' || a === 'mev' ? a : null);
  const app: 'foodhub' | 'phone' | 'mev' = (welcome ? named(welcome.app) : named(q.app)) ?? 'foodhub';
  const canSetup = Boolean(viewer && can(viewer.role, 'stores:map'));
  const steps = canSetup && state === 'connected' && app === 'foodhub'
    ? await onboardingSteps({ merchantId: welcome?.merchantId ?? null, viewerHasPin: viewer?.hasPin }).catch(() => null)
    : null;
  const here = `/welcome/clover${ticket ? `?t=${encodeURIComponent(ticket)}` : ''}`;

  const data: WelcomeData = {
    state,
    ticket: welcome && welcome.status !== 'gone' ? ticket : null,
    merchant: welcome ? { id: welcome.merchantId, name: welcome.name, city: welcome.profile?.city ?? null, region: welcome.profile?.region ?? null, country: welcome.profile?.country ?? null } : null,
    register: welcome?.profile ?? null,
    billing: welcome?.billing ?? null,
    error: state === 'error' ? (errCode ? CLOVER_CONNECT_ERRORS[errCode] : ticket ? CLOVER_CONNECT_ERRORS.state_expired : CLOVER_CONNECT_ERRORS.no_code) : null,
    viewer: viewer ? { name: viewer.name, canSetup } : null,
    steps,
    loginHref: `/login?next=${encodeURIComponent(here)}`,
    cloverUrl: cloverWebUrl(),
    support: { email: info.supportEmail, phone: info.supportPhone, hours: info.supportHours },
    ...(app !== 'foodhub' ? { app, appName: cloverApp(app).name } : {}),
  };
  // The Clover landing matches the Clover listing ("TAKATAK Food Hub"), whatever the console is called.
  return <KeepProductNames><WelcomeView data={data} /></KeepProductNames>;
}
