import type { ReactNode } from 'react';

/** Prose helpers shared by the legal pages. */
export function H1({ children }: { children: ReactNode }) { return <h1 className="text-2xl font-extrabold tracking-tight text-ink">{children}</h1>; }
export function H2({ children }: { children: ReactNode }) { return <h2 className="mt-7 text-lg font-bold text-ink">{children}</h2>; }
export function P({ children }: { children: ReactNode }) { return <p className="mt-2 text-[15px] leading-relaxed text-ink-2">{children}</p>; }
export function UL({ children }: { children: ReactNode }) { return <ul className="mt-2 list-disc space-y-1 pl-5 text-[15px] leading-relaxed text-ink-2">{children}</ul>; }
export function LangBlock({ id, children }: { id: string; children: ReactNode }) { return <section id={id} lang={id === 'en' ? 'en-CA' : 'fr-CA'} className="scroll-mt-6">{children}</section>; }
export function LangSwitch() {
  return <p className="mt-1 text-sm text-ink-3"><a href="#fr" className="underline">Français</a> · <a href="#en" className="underline">English</a></p>;
}
export function Divider() { return <hr className="my-10 border-line" />; }
/** One FAQ entry: a native <details> (works without JavaScript, keyboard and screen-reader friendly). */
export function Faq({ q, children }: { q: string; children: ReactNode }) {
  return (
    <details className="group mt-2 rounded-lg border border-line bg-surface px-4 py-3 open:shadow-card">
      <summary className="cursor-pointer list-none font-semibold text-ink marker:hidden [&::-webkit-details-marker]:hidden">
        <span className="mr-2 inline-block text-ink-3 transition-transform group-open:rotate-90">›</span>{q}
      </summary>
      <p className="mt-2 text-[15px] leading-relaxed text-ink-2">{children}</p>
    </details>
  );
}
