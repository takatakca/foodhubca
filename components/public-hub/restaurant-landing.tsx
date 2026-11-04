import Image from 'next/image';
import { ArrowRight, ArrowUpRight, Check, ChefHat, Layers3, LayoutDashboard, ListChecks, Menu, MonitorPlay, ReceiptText } from 'lucide-react';
import { CloverAppBadges } from '@/components/clover-app-badges';
import { LEGAL_PATHS } from '@/lib/foodhub/legal';
import { EXTRA_BRAND_PLATFORM_CAD, formatCadLabel, STANDARD_MONTHLY_CAD, TRIAL_DAYS, type Lang } from '@/lib/foodhub/pricing';
import { HUB_PATHS, hubFaq, hubJsonLd, jsonLdScript, type HubContext } from '@/lib/foodhub/public-hub';
import { RESTAURANT_COPY } from './restaurant-copy';
import styles from './restaurant-landing.module.css';

const PROVIDERS = ['Uber Eats', 'DoorDash', 'SkipTheDishes'];
const FEATURE_ICONS = [ChefHat, ListChecks, Layers3, ReceiptText];

/** Public merchant landing. Server-rendered; no session, form submission, tracker or page-specific client script. */
export function RestaurantLanding({ lang, ctx }: { lang: Lang; ctx: HubContext }) {
  const w = RESTAURANT_COPY[lang];
  const contact = ctx.supportEmail ? `mailto:${ctx.supportEmail}` : LEGAL_PATHS.support;
  const primary = ctx.appMarketUrl ?? contact;
  const action = ctx.appMarketUrl ? w.install : w.contact;
  const other = lang === 'fr' ? 'en' : 'fr';
  const home = HUB_PATHS.landing[lang];
  const faq = hubFaq('landing', lang, ctx);
  const status = ctx.appMarketUrl ? w.live : ctx.marketStatus === 'review' ? w.review : w.soon;
  const links = [{ href: '#fonctionnement', label: w.how }, { href: '#integrations', label: w.platforms }, { href: '#tarifs', label: w.pricing }];
  return (
    <div lang={lang === 'fr' ? 'fr-CA' : 'en-CA'} className={styles.page}>
      <a href="#contenu" className={styles.skip}>{w.skip}</a>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <a className={styles.wordmark} href={home}>
            <span>Food Hub<span className={styles.wordmarkDot}>.</span></span>
            <small>{w.endorsement}</small>
          </a>
          <nav className={styles.desktopNav} aria-label={w.nav}>
            {links.map((link) => <a key={link.href} href={link.href}>{link.label}</a>)}
          </nav>
          <div className={styles.headerActions}>
            <a className={styles.language} href={HUB_PATHS.landing[other]} hrefLang={other === 'fr' ? 'fr-CA' : 'en-CA'} lang={other}>{w.language}</a>
            <a href="/login" rel="nofollow" className={styles.login}>{w.login}<ArrowUpRight size={15} aria-hidden /></a>
            <details className={styles.mobileMenu}>
              <summary aria-label={w.menu}><Menu size={21} aria-hidden /></summary>
              <nav aria-label={w.nav}>{links.map((link) => <a key={link.href} href={link.href}>{link.label}</a>)}</nav>
            </details>
          </div>
        </div>
      </header>

      <main id="contenu">
        <section className={styles.hero} aria-labelledby="hero-title">
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}><span className={styles.eyebrowLine} />{w.eyebrow}</p>
            <h1 id="hero-title">{w.hero}<br /><span>{w.heroAccent}</span></h1>
            <p className={styles.heroLead}>{w.lead}</p>
            <div className={styles.heroActions}>
              <a className={styles.primary} href={primary}>{action}<ArrowUpRight size={18} aria-hidden /></a>
              <a className={styles.textLink} href="#fonctionnement">{w.explore}<ArrowRight size={17} aria-hidden /></a>
            </div>
            <p className={styles.local}>{w.local}<br />{w.bilingual}</p>
          </div>
          <figure className={styles.heroPhoto}>
            <Image src="/hub-media/restaurant-counter.webp" alt={w.heroAlt} width={1600} height={1117} priority sizes="(min-width: 900px) 48vw, 100vw" />
            <figcaption><span>FOOD HUB / RESTAURANTS</span><p>{w.photoLabel}<br /><em>{w.photoSub}</em></p></figcaption>
          </figure>
        </section>

        <section className={styles.platformBand} aria-label={w.providerLabel}>
          <p>{w.providerLabel}</p>
          <div>{PROVIDERS.map((provider) => <span key={provider}>{provider}</span>)}<span className={styles.cloverName}>Clover</span></div>
        </section>

        <section className={styles.operations} id="fonctionnement" aria-labelledby="operations-title">
          <div className={styles.sectionIntro}>
            <div><p className={styles.eyebrow}>{w.introLabel}</p><h2 id="operations-title">{w.intro}</h2></div>
            <p className={styles.sectionLead}>{w.introText}</p>
          </div>
          <div className={styles.featureGrid}>
            {w.features.map((feature, i) => {
              const Icon = FEATURE_ICONS[i];
              return <article className={styles.feature} key={feature.label}><div className={styles.featureTop}><Icon size={27} strokeWidth={1.4} aria-hidden /><span>0{i + 1}</span></div><p className={styles.micro}>{feature.label}</p><h3>{feature.title}</h3><p>{feature.text}</p></article>;
            })}
          </div>
        </section>

        <section className={styles.productFilm} aria-labelledby="product-film-title">
          <div className={styles.filmCopy}><p className={styles.eyebrow}>{w.videoLabel}</p><h2 id="product-film-title">{w.videoTitle}</h2><p>{w.videoText}</p></div>
          <figure><video controls playsInline preload="none" poster={`/hub-media/foodhub-product-demo-${lang}.jpg`} width={1920} height={1080} aria-label={w.videoText}><source src={`/hub-media/foodhub-product-demo-${lang}.mp4`} type="video/mp4" /><track kind="captions" src={`/hub-media/foodhub-product-demo-${lang}.vtt`} srcLang={lang} label={lang === 'fr' ? 'Français' : 'English'} /><a href={`/hub-media/foodhub-product-demo-${lang}.mp4`}>{w.videoDownload}</a></video><figcaption>{w.videoCaption}</figcaption><details><summary>{w.videoTranscriptLabel}</summary><p>{w.videoTranscript}</p></details></figure>
        </section>

        <section className={styles.tablets} aria-labelledby="tablets-title">
          <div className={styles.tabletCopy}><p className={styles.eyebrow}>{w.tabletLabel}</p><h2 id="tablets-title">{w.tabletTitle}</h2><p>{w.tabletText}</p>
            <ul>{w.tabletPoints.map((point) => <li key={point}><Check size={16} aria-hidden />{point}</li>)}</ul>
            <a className={styles.textLink} href={contact}>{w.contact}<ArrowUpRight size={17} aria-hidden /></a>
          </div>
          <div className={styles.tabletVisual}>
            <div className={styles.tabletVisualHeader}><span><MonitorPlay size={17} aria-hidden />Food Hub</span><span>{w.tabletPreview}</span></div>
            <figure className={styles.tabletCapture}><Image src={lang === 'en' ? '/hub-media/tablet-wall-demo-en.webp' : '/hub-media/tablet-wall-demo.webp'} alt={w.tabletAlt} width={1440} height={810} sizes="(min-width: 900px) 55vw, 100vw" /><figcaption>{w.tabletCaption}</figcaption></figure>
            <p className={styles.tabletPrivacy}>{w.tabletPrivacy}</p>
          </div>
          <p className={styles.tabletSetup}>{w.tabletSetup}</p>
        </section>

        <section className={styles.setup} aria-labelledby="setup-title">
          <p className={styles.eyebrow}>{w.setupLabel}</p><h2 id="setup-title">{w.setupTitle}</h2>
          <ol>{w.steps.map((step, i) => <li key={step.title}><span>0{i + 1}</span><h3>{step.title}</h3><p>{step.text}</p></li>)}</ol>
        </section>

        <section className={styles.integrations} id="integrations" aria-labelledby="integrations-title">
          <div className={styles.integrationIntro}><p className={styles.eyebrow}>{w.integrationsLabel}</p><h2 id="integrations-title">{w.integrationsTitle}</h2><p>{w.integrationsText}</p><a className={styles.textLink} href={contact}>{w.otherRegister}<ArrowUpRight size={17} aria-hidden /></a></div>
          <div className={styles.connectionList}><p className={styles.micro}>{w.delivery}</p>{PROVIDERS.map((provider, i) => <div className={styles.connectionRow} key={provider}><a href={HUB_PATHS[(['uber', 'doordash', 'skip'] as const)[i]][lang]}>{provider}<ArrowUpRight size={17} aria-hidden /></a><span>{w.setupRequired}</span></div>)}<p className={`${styles.micro} ${styles.registerLabel}`}>{w.register}</p><div className={styles.cloverRow}><LayoutDashboard size={27} strokeWidth={1.3} aria-hidden /><div><b>Clover</b><p>{w.cloverDescription}</p></div></div></div>
          <p className={styles.availability}>{w.availability}</p>
        </section>

        <section className={styles.pricing} id="tarifs" aria-labelledby="pricing-title">
          <div className={styles.priceIntro}><p className={styles.eyebrow}>{w.priceLabel}</p><h2 id="pricing-title">{w.priceTitle}</h2><p>{w.priceIncludes}</p><a className={styles.textLink} href={HUB_PATHS.pricing[lang]}>{w.priceDetail}<ArrowRight size={17} aria-hidden /></a></div>
          <div className={styles.priceCard}><p className={styles.micro}>{w.plan}</p><div className={styles.price}><strong>{formatCadLabel(STANDARD_MONTHLY_CAD, lang)}</strong><span>{w.monthly}</span></div><p className={styles.trial}>{TRIAL_DAYS} {w.trial}</p><div className={styles.priceExtra}><b>+ {formatCadLabel(EXTRA_BRAND_PLATFORM_CAD, lang)}</b><p>{w.extra}</p></div><a className={styles.primary} href={primary}>{action}<ArrowUpRight size={18} aria-hidden /></a><p className={styles.marketStatus}>{status}</p><p className={styles.priceTerms}>{w.tax}</p></div>
          <aside className={styles.phone}><div><p>{w.phone}</p><span>{w.phoneText}</span></div><a href={HUB_PATHS.phone[lang]} aria-label={w.phone}><ArrowUpRight size={22} aria-hidden /></a></aside>
        </section>

        <section className={styles.faq} aria-labelledby="faq-title"><div><p className={styles.eyebrow}>{w.faqLabel}</p><h2 id="faq-title">{w.faqTitle}</h2></div><div className={styles.questions}>{faq.map((f) => <details key={f.q}><summary>{f.q}<span aria-hidden>+</span></summary><p>{f.a}</p></details>)}</div></section>

        <section className={styles.final} aria-labelledby="contact-title"><div><p className={styles.eyebrow}>{w.finalLabel}</p><h2 id="contact-title">{w.finalTitle}</h2></div><div><p>{w.finalText}</p><a className={styles.primary} href={contact}>{w.contact}<ArrowUpRight size={18} aria-hidden /></a></div></section>

        <aside className={styles.diner}><p>{w.diner}</p><a href="https://on2go.ca/">{w.dinerLink}<ArrowUpRight size={17} aria-hidden /></a></aside>
      </main>

      <footer className={styles.footer}><div className={styles.footerTop}><a className={styles.wordmark} href={home}><span>Food Hub<span className={styles.wordmarkDot}>.</span></span><small>{w.endorsement}</small></a><nav aria-label={w.support}><a href={LEGAL_PATHS.support}>{w.support}</a><a href={LEGAL_PATHS.privacy}>{w.privacy}</a><a href={LEGAL_PATHS.terms}>{w.terms}</a></nav></div><div className={styles.footerBottom}><p>{w.footerLine} {ctx.company}.<br />© {new Date().getFullYear()} {ctx.company} · {ctx.address}</p><p>{w.trademark}</p></div>{ctx.supportEmail && <a href={contact} className={styles.supportEmail}>{ctx.supportEmail}</a>}<CloverAppBadges apps={ctx.cloverApps ?? []} lang={lang} variant="compact" className={styles.cloverBadges} /></footer>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(hubJsonLd('landing', lang, ctx)) }} />
    </div>
  );
}
