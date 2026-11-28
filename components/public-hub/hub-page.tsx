import type { ReactNode } from 'react';
import { TakatakMark } from '@/components/brand/takatak-mark';
import { CloverAppBadges } from '@/components/clover-app-badges';
import { LEGAL_PATHS } from '@/lib/foodhub/legal';
import { EXTRA_BRAND_PLATFORM_CAD, formatCadLabel, PHONE_APP_NAME, PHONE_PRICING_STATEMENT, STANDARD_MONTHLY_CAD, TRIAL_DAYS, type Lang } from '@/lib/foodhub/pricing';
import {
  fillHub, HUB_CONTENT, HUB_NAME, HUB_PATHS, hubBenefits, hubCertificationNote, hubFaq, hubFeatures, hubIndexable, hubJsonLd,
  hubRequirements, jsonLdScript, pendingPlatforms, platformList, type HubContext, type HubPageKey,
} from '@/lib/foodhub/public-hub';
import { HUB_UI, type Block, type Card } from '@/lib/foodhub/public-hub-content';
import { HeroShot, LandingTour } from './landing-tour';
import landing from './landing.module.css';

// The public TAKATAK Food Hub pages (/hub, /en/hub…): server-rendered, no page-specific client component, no tracker, no
// session, no database (the root layout still ships its own small boot script and the Next.js runtime).
// Everything from the environment arrives in `ctx` (hubContext()), so this component renders the same in tests.

const PLATFORMS = ['Uber Eats', 'DoorDash', 'SkipTheDishes', 'Too Good To Go*'];

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-6 border-t border-line py-12 sm:scroll-mt-24">
      <h2 id={`${id}-title`} className="text-2xl font-extrabold tracking-tight text-ink">{title}</h2>
      {children}
    </section>
  );
}

function Cards({ cards, lang, ctx }: { cards: Card[]; lang: Lang; ctx: HubContext }) {
  return (
    <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {cards.map((c) => (
        <li key={c.title} className="rounded-lg border border-line bg-surface p-5 shadow-card">
          <h3 className="font-bold text-ink">{c.title}</h3>
          <p className="mt-2 text-[15px] leading-relaxed text-ink-2">{fillHub(c.text, lang, ctx)}</p>
        </li>
      ))}
    </ul>
  );
}

function MarketButton({ lang, ctx, large }: { lang: Lang; ctx: HubContext; large?: boolean }) {
  const ui = HUB_UI[lang];
  const pad = large ? 'px-5 py-3 text-base' : 'px-4 py-2 text-sm';
  if (ctx.appMarketUrl) {
    return (
      <a href={ctx.appMarketUrl} rel="noopener" className={`inline-flex items-center rounded-md bg-brand font-bold text-on-brand hover:bg-brand-2 ${pad}`}>
        {ui.marketCta}
      </a>
    );
  }
  return (
    <span className={`inline-flex items-center rounded-md border border-line-2 bg-raised font-bold text-ink ${pad}`}>
      {ctx.marketStatus === 'review' ? ui.marketReview : ui.marketSoon}
    </span>
  );
}

/** Where "ask for a demo" goes: a pre-filled email when the support address is set, else the support page. */
function demoHref(lang: Lang, ctx: HubContext): string {
  if (!ctx.supportEmail) return LEGAL_PATHS.support;
  return `mailto:${ctx.supportEmail}?subject=${encodeURIComponent(HUB_UI[lang].demoSubject)}`;
}

/** The hero and closing buttons: the App Market listing once it is live; until then, a demo request (a real link,
 * never a button that does nothing) with the review status written under it. */
function Ctas({ lang, ctx, page, center }: { lang: Lang; ctx: HubContext; page: HubPageKey; center?: boolean }) {
  const ui = HUB_UI[lang];
  const secondary = 'inline-flex rounded-md border border-silver/40 px-5 py-3 font-bold text-white hover:border-white';
  return (
    <>
      <div className={`mt-8 flex flex-wrap items-center gap-3 ${center ? 'justify-center' : ''}`}>
        {ctx.appMarketUrl
          ? <MarketButton lang={lang} ctx={ctx} large />
          : <a href={demoHref(lang, ctx)} className="inline-flex rounded-md bg-brand px-5 py-3 text-base font-bold text-on-brand shadow-[0_8px_30px_-8px_rgb(31_139_255/0.8)] hover:bg-brand-2">{ui.demoCta}</a>}
        {page !== 'pricing'
          ? <a href={HUB_PATHS.pricing[lang]} className={secondary}>{ui.seePricing}</a>
          : ctx.appMarketUrl && <a href={demoHref(lang, ctx)} className={secondary}>{ui.demoCta}</a>}
      </div>
      {!ctx.appMarketUrl && (
        <p className={`mt-3 flex items-center gap-2 text-[13px] font-semibold text-silver ${center ? 'justify-center' : ''}`}>
          <span aria-hidden className="size-2 rounded-full bg-wait" />{ctx.marketStatus === 'review' ? ui.marketReview : ui.marketSoon}
        </p>
      )}
    </>
  );
}

function PricingBlock({ lang, ctx }: { lang: Lang; ctx: HubContext }) {
  const ui = HUB_UI[lang];
  return (
    <div className="mt-6 rounded-xl border border-line bg-surface p-6 shadow-card">
      <p className="inline-flex rounded-full bg-brand-soft px-3 py-1 text-[13px] font-bold text-brand">
        {ctx.appMarketUrl ? ui.marketLive : ui.pricingBadge}
      </p>
      <dl className="mt-5 grid gap-5 sm:grid-cols-3">
        <div className="flex flex-col-reverse">
          <dt className="text-sm text-ink-3">{ui.trial}</dt>
          <dd className="text-3xl font-extrabold text-ink">{TRIAL_DAYS}</dd>
        </div>
        <div className="flex flex-col-reverse">
          <dt className="text-sm text-ink-3">{ui.perMonthPerApp}</dt>
          <dd className="text-3xl font-extrabold text-ink">{formatCadLabel(STANDARD_MONTHLY_CAD, lang)}</dd>
        </div>
        <div className="flex flex-col-reverse">
          <dt className="text-sm text-ink-3">{ui.perExtraBrand}</dt>
          <dd className="text-3xl font-extrabold text-ink">+{formatCadLabel(EXTRA_BRAND_PLATFORM_CAD, lang)}</dd>
        </div>
      </dl>
      <p className="mt-5 text-[15px] text-ink-2">{ui.firstBrand} {ui.billedByClover}</p>
      <p className="mt-3 text-[15px] text-ink-2"><b className="text-ink">{PHONE_APP_NAME}</b>{lang === 'fr' ? ' : ' : ': '}{PHONE_PRICING_STATEMENT[lang]}</p>
      <CloverAppBadges apps={ctx.cloverApps ?? []} lang={lang} />
      <div className="mt-5 flex flex-wrap items-center gap-3">
        {ctx.appMarketUrl
          ? <MarketButton lang={lang} ctx={ctx} />
          : <a href={demoHref(lang, ctx)} className="inline-flex items-center rounded-md bg-brand px-4 py-2 text-sm font-bold text-on-brand hover:bg-brand-2">{ui.demoCta}</a>}
        {!ctx.appMarketUrl && <span className="text-sm text-ink-3">{ctx.marketStatus === 'review' ? ui.marketReviewNote : ui.marketSoonNote}</span>}
      </div>
    </div>
  );
}

function BlockView({ block, lang, ctx }: { block: Block; lang: Lang; ctx: HubContext }) {
  switch (block.kind) {
    case 'benefits':
      return (
        <Section id={block.id} title={block.title}>
          <ul className="mt-6 grid gap-3 sm:grid-cols-2">
            {hubBenefits(lang).map((b) => (
              <li key={b} className="flex gap-3 rounded-lg border border-line bg-surface p-4 text-[15px] leading-relaxed text-ink-2">
                <span aria-hidden className="font-black text-brand">✓</span><span>{b}</span>
              </li>
            ))}
          </ul>
        </Section>
      );
    case 'features':
      return (
        <Section id={block.id} title={block.title}>
          {block.intro && <p className="mt-2 max-w-3xl text-[15px] text-ink-2">{block.intro}</p>}
          <Cards cards={[...hubFeatures(lang), ...(block.extra ?? [])]} lang={lang} ctx={ctx} />
        </Section>
      );
    case 'cards':
      return (
        <Section id={block.id} title={block.title}>
          {block.intro && <p className="mt-2 max-w-3xl text-[15px] text-ink-2">{block.intro}</p>}
          <Cards cards={block.cards} lang={lang} ctx={ctx} />
        </Section>
      );
    case 'steps':
      return (
        <Section id={block.id} title={block.title}>
          <ol className="mt-6 grid gap-4 sm:grid-cols-3">
            {block.steps.map((s, i) => (
              <li key={s.title} className="rounded-lg border border-line bg-surface p-5">
                <span aria-hidden className="flex size-8 items-center justify-center rounded-full bg-rail font-extrabold text-white">{i + 1}</span>
                <h3 className="mt-3 font-bold text-ink">{s.title}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-ink-2">{fillHub(s.text, lang, ctx)}</p>
              </li>
            ))}
          </ol>
        </Section>
      );
    case 'requirements':
      return (
        <Section id={block.id} title={block.title}>
          <p className="mt-3 max-w-3xl text-[15px] leading-relaxed text-ink-2">{hubRequirements(lang)}</p>
        </Section>
      );
    case 'text':
      return (
        <Section id={block.id} title={block.title}>
          {block.paragraphs.map((p) => <p key={p} className="mt-3 max-w-3xl text-[15px] leading-relaxed text-ink-2">{fillHub(p, lang, ctx)}</p>)}
          {block.id === 'montreal' && (
            <p className="mt-3 text-[15px]"><a href="https://on2go.ca/" className="font-semibold text-brand underline underline-offset-2">on2go.ca</a></p>
          )}
          {(block.id === 'application' || block.id === 'app') && <ContactLine lang={lang} ctx={ctx} />}
        </Section>
      );
    case 'pricing':
      return (
        <Section id={block.id} title={block.title}>
          <PricingBlock lang={lang} ctx={ctx} />
        </Section>
      );
    case 'links':
      return (
        <Section id={block.id} title={block.title}>
          <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {block.pages.map((k) => {
              const c = HUB_CONTENT[k][lang];
              return (
                <li key={k}>
                  <a href={HUB_PATHS[k][lang]} className="block h-full rounded-lg border border-line bg-surface p-4 hover:border-brand">
                    <span className="font-bold text-brand underline-offset-2 hover:underline">{c.label}</span>
                    {!hubIndexable(k, ctx) && <span className="ml-2 rounded-full bg-wait-soft px-2 py-0.5 text-xs font-bold text-ink">{HUB_UI[lang].certBadge}</span>}
                    <span className="mt-1 block text-sm text-ink-2">{c.description}</span>
                  </a>
                </li>
              );
            })}
          </ul>
        </Section>
      );
  }
}

function ContactLine({ lang, ctx }: { lang: Lang; ctx: HubContext }) {
  const ui = HUB_UI[lang];
  const href = ctx.supportEmail ? `mailto:${ctx.supportEmail}` : LEGAL_PATHS.support;
  return (
    <p className="mt-4">
      <a href={href} className="inline-flex rounded-md bg-brand px-4 py-2 text-sm font-bold text-white hover:bg-brand-2">{ui.contact}</a>
    </p>
  );
}

export function HubPage({ page, lang, ctx }: { page: HubPageKey; lang: Lang; ctx: HubContext }) {
  const c = HUB_CONTENT[page][lang];
  const ui = HUB_UI[lang];
  const other: Lang = lang === 'fr' ? 'en' : 'fr';
  const home = HUB_PATHS.landing[lang];
  const faq = hubFaq(page, lang, ctx);
  const certification = hubCertificationNote(page, lang, ctx);
  const pending = pendingPlatforms(ctx);
  const isLanding = page === 'landing';
  return (
    <div lang={lang === 'fr' ? 'fr-CA' : 'en-CA'} className="min-h-dvh bg-canvas text-ink">
      <a href="#contenu" className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-30 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2">{ui.skip}</a>
      <header className="z-20 border-b border-white/10 bg-rail/95 text-white backdrop-blur sm:sticky sm:top-0">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <a href={home} className="flex items-center gap-2 text-lg font-extrabold tracking-tight">
            <TakatakMark size="sm" /><span>TAKATAK <span className="font-semibold text-silver">Food Hub</span></span>
          </a>
          <nav aria-label={ui.nav} className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm font-semibold text-silver">
            <a href={`${home}#${lang === 'fr' ? 'produit' : 'product'}`} className="inline-flex min-h-11 items-center hover:text-white">{ui.product}</a>
            <a href={`${home}#integrations`} className="inline-flex min-h-11 items-center hover:text-white">{ui.integrations}</a>
            <a href={HUB_PATHS.pricing[lang]} className="inline-flex min-h-11 items-center hover:text-white">{ui.pricing}</a>
            <a href={HUB_PATHS[page][other]} hrefLang={other === 'fr' ? 'fr-CA' : 'en-CA'} lang={other === 'fr' ? 'fr-CA' : 'en-CA'} className="inline-flex min-h-11 items-center hover:text-white">{ui.otherLang}</a>
            <a href="/login" rel="nofollow" className="inline-flex min-h-11 items-center rounded-md border border-silver/40 px-3 text-white hover:border-white">{ui.signIn}</a>
          </nav>
        </div>
      </header>

      <main id="contenu" tabIndex={-1} className="sm:scroll-mt-28">
        <div className={isLanding ? landing.hero : 'bg-rail text-white'}>
          <div className={`mx-auto max-w-6xl px-4 text-white ${isLanding ? landing.heroLayout : 'pb-14 pt-10'}`}>
            <div className={isLanding ? landing.heroCopy : ''}>
              {page !== 'landing' && (
                <nav aria-label={ui.breadcrumb} className="mb-4 text-sm text-silver">
                  <a href={home} className="underline underline-offset-2 hover:text-white">{HUB_NAME}</a>
                  <span aria-hidden> › </span>
                  <span aria-current="page">{c.label}</span>
                </nav>
              )}
              <p className="text-[13px] font-bold uppercase tracking-[0.12em] text-cyan">{c.eyebrow}</p>
              <h1 className={`mt-3 font-extrabold leading-[1.08] tracking-tight ${isLanding ? landing.heroTitle : 'max-w-4xl text-3xl sm:text-5xl'}`}>
                {c.h1}
              </h1>
              {certification && (
                <p className="mt-4 inline-flex rounded-full bg-wait px-3 py-1 text-sm font-bold text-rail">{certification}</p>
              )}
              <p className={`mt-5 text-lg leading-relaxed text-silver ${isLanding ? 'max-w-xl sm:text-xl' : 'max-w-3xl'}`}>{fillHub(c.lead, lang, ctx)}</p>
              <Ctas lang={lang} ctx={ctx} page={page} />
              {page === 'landing' && (
                <div className="mt-8">
                  <p className="sr-only">{ui.platformsLabel}</p>
                  <ul className="flex flex-wrap gap-2">
                    {[...PLATFORMS, 'Clover'].map((p) => (
                      <li key={p} className="rounded-full border border-silver/30 bg-white/5 px-3 py-1 text-sm font-semibold text-white">{p}</li>
                    ))}
                  </ul>
                  <p className="mt-2 text-[13px] text-silver">* {ui.tgtgNote}</p>
                  {pending.length > 0 && (
                    <p className="mt-1 text-[13px] text-silver">{ui.pending.trim().replace('{platforms}', platformList(pending, lang))}</p>
                  )}
                </div>
              )}
            </div>
            {isLanding && <HeroShot lang={lang} />}
          </div>
        </div>

        {isLanding && <LandingTour lang={lang} />}

        <div className="mx-auto max-w-6xl px-4">
          {c.blocks.map((b) => <BlockView key={b.id} block={b} lang={lang} ctx={ctx} />)}

          {faq.length > 0 && (
            <Section id="faq" title={ui.faq}>
              <div className="mt-4 max-w-3xl">
                {faq.map((f) => (
                  <details key={f.q} className="mt-2 rounded-lg border border-line bg-surface px-4 py-3">
                    <summary className="cursor-pointer font-semibold text-ink">{f.q}</summary>
                    <p className="mt-2 text-[15px] leading-relaxed text-ink-2">{f.a}</p>
                  </details>
                ))}
              </div>
            </Section>
          )}

          <section aria-labelledby="cta-title" className={`my-16 overflow-hidden rounded-2xl px-6 py-12 text-center text-white sm:px-12 ${landing.hero}`}>
            <h2 id="cta-title" className="mx-auto max-w-2xl text-3xl font-extrabold tracking-tight">{ui.ctaTitle}</h2>
            <p className="mx-auto mt-3 max-w-xl text-silver">{ui.ctaLead}</p>
            <Ctas lang={lang} ctx={ctx} page={page} center />
          </section>
        </div>
      </main>

      <footer className="border-t border-line bg-surface">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-8 text-[13px] text-ink-3 sm:flex-row sm:flex-wrap sm:justify-between">
          <div>
            <p className="font-bold text-ink">{HUB_NAME}</p>
            <p>{ui.madeIn} {ui.footerOn2go} <a href="https://on2go.ca/" className="underline underline-offset-2 hover:text-ink">on2go.ca</a></p>
            <p>© {new Date().getFullYear()} {ctx.company} · {ctx.address}</p>
            {ctx.supportEmail && <p><a href={`mailto:${ctx.supportEmail}`} className="underline underline-offset-2">{ctx.supportEmail}</a></p>}
            <CloverAppBadges apps={ctx.cloverApps ?? []} lang={lang} variant="compact" className="mt-3" />
          </div>
          <nav aria-label={ui.support} className="flex flex-wrap gap-4 font-semibold">
            <a href={LEGAL_PATHS.support} className="underline underline-offset-2 hover:text-ink">{ui.support}</a>
            <a href={LEGAL_PATHS.privacy} className="underline underline-offset-2 hover:text-ink">{ui.privacy}</a>
            <a href={LEGAL_PATHS.terms} className="underline underline-offset-2 hover:text-ink">{ui.terms}</a>
          </nav>
        </div>
      </footer>

      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(hubJsonLd(page, lang, ctx)) }} />
    </div>
  );
}
