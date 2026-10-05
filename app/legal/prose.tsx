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
