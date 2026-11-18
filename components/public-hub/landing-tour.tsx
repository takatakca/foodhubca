import type { ReactNode } from 'react';
import { hubBenefits } from '@/lib/foodhub/public-hub';
import type { Lang } from '@/lib/foodhub/pricing';
import { HUB_SHOTS, shotSrc, shotSrcSet, TOUR, type ShotKey, type TourSection } from '@/lib/foodhub/public-hub-tour';
import s from './landing.module.css';

// The public landing's pictures: real stills of the console (lib/foodhub/public-hub-tour.ts), server-rendered as
// plain <img> with a WebP srcset and their intrinsic size (no layout shift, no client component, no script).
// The hero still loads first; every other still is lazy.

function Shot({ shot, lang, alt, sizes, eager, className }: { shot: ShotKey; lang: Lang; alt: string; sizes: string; eager?: boolean; className?: string }) {
  const meta = HUB_SHOTS[shot];
  return (
    // eslint-disable-next-line @next/next/no-img-element -- pre-sized WebP stills on a page that ships no client component
    <img
      src={shotSrc(shot, lang, meta.widths[0])}
      srcSet={shotSrcSet(shot, lang)}
      sizes={sizes}
      width={meta.width}
      height={meta.height}
      alt={alt}
      loading={eager ? 'eager' : 'lazy'}
      fetchPriority={eager ? 'high' : undefined}
      decoding="async"
      className={className}
    />
  );
}

/** A console still in a light window frame, with the address bar of the real console. */
function Window({ children, address }: { children: ReactNode; address: string }) {
  return (
    <div className={s.window}>
      <div className={s.windowBar} aria-hidden>
        <span className={s.dot} /><span className={s.dot} /><span className={s.dot} />
        <span className={s.address}>{address}</span>
      </div>
      {children}
    </div>
  );
}

const ADDRESS: Record<ShotKey, string> = {
  orders: 'foodhub.on2go.ca/orders', today: 'foodhub.on2go.ca', reports: 'foodhub.on2go.ca/insights',
  kitchen: 'foodhub.on2go.ca/kitchen', newOrder: 'foodhub.on2go.ca/kitchen', phone: 'foodhub.on2go.ca/commander',
};

/** The orders board under the landing's hero text. */
export function HeroShot({ lang }: { lang: Lang }) {
  const w = TOUR[lang];
  return (
    <figure className={s.heroShot}>
      <Window address={ADDRESS.orders}>
        <Shot shot="orders" lang={lang} alt={w.heroAlt} sizes="(min-width: 1120px) 1088px, calc(100vw - 32px)" eager className={s.img} />
      </Window>
      <figcaption className="mt-3 text-center text-[13px] text-silver">{w.demoNote}</figcaption>
    </figure>
  );
}

function TourPicture({ section, lang }: { section: TourSection; lang: Lang }) {
  if (section.shot === 'phone') {
    return (
      <div className={s.phone}>
        <Shot shot="phone" lang={lang} alt={section.alt} sizes="300px" className={s.img} />
      </div>
    );
  }
  return (
    <div className="relative">
      <Window address={ADDRESS[section.shot]}>
        <Shot shot={section.shot} lang={lang} alt={section.alt} sizes="(min-width: 1024px) 640px, calc(100vw - 32px)" className={s.img} />
      </Window>
      {section.inset && (
        <div className={s.inset}>
          <Shot shot={section.inset} lang={lang} alt={section.insetAlt ?? ''} sizes="(min-width: 1024px) 360px, 60vw" className={s.img} />
        </div>
      )}
    </div>
  );
}

/** What changes (the listing's five benefits), then the product tour, one real screen per section. */
export function LandingTour({ lang }: { lang: Lang }) {
  const w = TOUR[lang];
  return (
    <>
      <section aria-labelledby="avantages-title" className={s.benefits}>
        <div className="mx-auto max-w-6xl px-4">
          <h2 id="avantages-title" className="text-center text-[13px] font-bold uppercase tracking-[0.12em] text-brand">{w.benefitsTitle}</h2>
          <ul className="mt-6 grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
            {hubBenefits(lang).map((b) => (
              <li key={b} className="flex gap-3 text-[15px] leading-relaxed text-ink-2">
                <span aria-hidden className={s.check}>✓</span><span>{b}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section id={lang === 'fr' ? 'produit' : 'product'} aria-labelledby="produit-title" className="scroll-mt-20 bg-canvas py-16 sm:py-24">
        <div className="mx-auto max-w-6xl px-4">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-[13px] font-bold uppercase tracking-[0.12em] text-brand">{w.tourEyebrow}</p>
            <h2 id="produit-title" className="mt-3 text-3xl font-extrabold tracking-tight text-ink sm:text-4xl">{w.tourTitle}</h2>
            <p className="mt-4 text-lg leading-relaxed text-ink-2">{w.tourLead}</p>
          </div>
          <div className="mt-14 space-y-20 sm:mt-20 sm:space-y-28">
            {w.sections.map((section, i) => (
              <article key={section.id} id={section.id} aria-labelledby={`${section.id}-title`} className={`${s.row} ${i % 2 ? s.rowFlip : ''}`}>
                <div className={s.copy}>
                  <p className="text-[13px] font-bold uppercase tracking-[0.12em] text-brand">{section.eyebrow}</p>
                  <h3 id={`${section.id}-title`} className="mt-3 text-2xl font-extrabold tracking-tight text-ink sm:text-3xl">{section.title}</h3>
                  <p className="mt-4 text-[16px] leading-relaxed text-ink-2">{section.text}</p>
                  <ul className="mt-5 space-y-2.5">
                    {section.points.map((p) => (
                      <li key={p} className="flex gap-3 text-[15px] text-ink-2"><span aria-hidden className={s.check}>✓</span><span>{p}</span></li>
                    ))}
                  </ul>
                </div>
                <div className={s.picture}><TourPicture section={section} lang={lang} /></div>
              </article>
            ))}
          </div>
          <p className="mt-16 text-center text-[13px] text-ink-3">{w.demoNote}</p>
        </div>
      </section>
    </>
  );
}
