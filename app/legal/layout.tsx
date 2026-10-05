import Link from 'next/link';
import type { ReactNode } from 'react';
import { legalInfo, LEGAL_PATHS } from '@/lib/foodhub/legal';

export const dynamic = 'force-dynamic';

// Public pages (no sign-in, see proxy.ts): privacy policy, terms of use and support for TAKATAK Food Hub.
// These are the URLs given to the Clover App Market and the delivery platforms.
export default function LegalLayout({ children }: { children: ReactNode }) {
  const info = legalInfo();
  return (
    <div className="min-h-dvh bg-canvas text-ink">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <Link href={LEGAL_PATHS.support} className="flex items-center gap-2 font-extrabold tracking-tight">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icons/icon-192.png" alt="" className="size-8 rounded-lg" />
            {info.appName}
          </Link>
          <nav className="flex flex-wrap gap-4 text-sm font-semibold text-ink-2">
            <Link href={LEGAL_PATHS.privacy} className="hover:text-ink">Confidentialité · Privacy</Link>
            <Link href={LEGAL_PATHS.terms} className="hover:text-ink">Conditions · Terms</Link>
            <Link href={LEGAL_PATHS.support} className="hover:text-ink">Soutien · Support</Link>
          </nav>
        </div>
      </header>
      {!info.approved && (
        <div className="border-b border-line bg-wait-soft">
          <p className="mx-auto max-w-3xl px-4 py-2 text-[13px] font-semibold text-ink">
            Projet à faire valider avant la publication (propriétaire et conseiller juridique). · Draft — to be reviewed before publication (owner and legal adviser).
          </p>
        </div>
      )}
      <main className="mx-auto max-w-3xl px-4 py-8">{children}</main>
      <footer className="border-t border-line">
        <div className="mx-auto max-w-3xl px-4 py-6 text-[13px] text-ink-3">
          © {new Date().getFullYear()} {info.company} · {info.address}
        </div>
      </footer>
    </div>
  );
}
