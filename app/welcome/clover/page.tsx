import type { Metadata } from 'next';
import Link from 'next/link';
import { legalInfo, LEGAL_PATHS } from '@/lib/foodhub/legal';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'TAKATAK Food Hub — Clover' };

// Public landing page after a merchant opens the "TAKATAK Food Hub" app from Clover (see clover-connect/callback).
// Shows whether the register is connected, waiting for the owner's approval, or why it failed. No sign-in needed.
export default async function CloverWelcomePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const q = await searchParams;
  const status = q.status === 'connected' || q.status === 'pending' ? q.status : 'error';
  const mid = /^[A-Z0-9]{8,20}$/i.test(q.mid || '') ? q.mid : null;
  const name = (q.name || '').slice(0, 120) || null;
  const msg = (q.msg || '').slice(0, 300);
  const info = legalInfo();
  const who = name ? `${name}${mid ? ` (${mid})` : ''}` : mid;
  const tone = status === 'connected' ? 'bg-go-soft' : status === 'pending' ? 'bg-wait-soft' : 'bg-stop-soft';
  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas p-4 text-ink">
      <div className="w-full max-w-lg rounded-2xl border border-line bg-surface p-6 shadow-sm">
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/icon-192.png" alt="" className="size-10 rounded-xl" />
          <div><div className="text-lg font-extrabold tracking-tight">{info.appName}</div><div className="text-[13px] text-ink-3">Clover</div></div>
        </div>
        <div className={`mt-5 rounded-xl p-4 ${tone}`}>
          {status === 'connected' && <>
            <p className="font-bold">Caisse Clover branchée ✓{who ? ` — ${who}` : ''}</p>
            <p className="mt-1 text-[14px] text-ink-2">Les commandes Uber Eats, DoorDash et SkipTheDishes de ce restaurant arriveront maintenant dans Clover.</p>
            <p className="mt-3 font-bold" lang="en">Clover register connected ✓</p>
            <p className="mt-1 text-[14px] text-ink-2" lang="en">Uber Eats, DoorDash and SkipTheDishes orders for this restaurant will now reach Clover.</p>
          </>}
          {status === 'pending' && <>
            <p className="font-bold">Demande reçue{who ? ` — ${who}` : ''}</p>
            <p className="mt-1 text-[14px] text-ink-2">Votre caisse attend l’approbation du propriétaire de TAKATAK Food Hub. Rien n’est envoyé à votre caisse avant cette approbation.</p>
            <p className="mt-3 font-bold" lang="en">Request received</p>
            <p className="mt-1 text-[14px] text-ink-2" lang="en">Your register is waiting for the TAKATAK Food Hub owner’s approval. Nothing is sent to your register until then.</p>
          </>}
          {status === 'error' && <>
            <p className="font-bold">Le branchement n’a pas fonctionné · The connection did not work</p>
            {msg && <p className="mt-1 text-[14px] text-ink-2">{msg}</p>}
            <p className="mt-2 text-[14px] text-ink-2">Rouvrez l’application depuis Clover, ou écrivez-nous. · Open the app again from Clover, or contact us.</p>
          </>}
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Link href="/" className="inline-flex h-10 items-center rounded-lg bg-ink px-4 text-sm font-semibold text-surface hover:opacity-90">Ouvrir Food Hub · Open Food Hub</Link>
          <Link href={LEGAL_PATHS.support} className="text-sm font-semibold text-ink-2 underline">Soutien · Support</Link>
        </div>
        <p className="mt-4 text-[12px] text-ink-3">
          <Link href={LEGAL_PATHS.privacy} className="underline">Confidentialité · Privacy</Link> · <Link href={LEGAL_PATHS.terms} className="underline">Conditions · Terms</Link>
        </p>
      </div>
    </div>
  );
}
