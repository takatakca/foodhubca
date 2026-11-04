import type { ReactNode } from 'react';
import { ArrowUpRight, Menu } from 'lucide-react';
import { CloverAppBadges } from '@/components/clover-app-badges';
import { LEGAL_PATHS } from '@/lib/foodhub/legal';
import { publicSupportEmail, publicSupportHref } from '@/lib/foodhub/public-support';
import type { Lang } from '@/lib/foodhub/pricing';
import { HUB_PATHS, hubJsonLd, jsonLdScript, type HubContext, type HubPageKey } from '@/lib/foodhub/public-hub';
import { RESTAURANT_COPY } from './restaurant-copy';
import styles from './restaurant-landing.module.css';

/** One bilingual public merchant shell; the selected page controls its own language twin and active navigation. */
export function RestaurantShell({ page, lang, ctx, children }: { page: HubPageKey; lang: Lang; ctx: HubContext; children: ReactNode }) {
  const w = RESTAURANT_COPY[lang];
  const home = HUB_PATHS.landing[lang];
  const other = lang === 'fr' ? 'en' : 'fr';
  const contact = publicSupportHref(ctx.supportEmail);
  const links = [
    { href: `${page === 'landing' ? '' : home}#fonctionnement`, label: w.how, current: false },
    { href: `${page === 'landing' ? '' : home}#integrations`, label: w.platforms, current: false },
    { href: page === 'landing' ? '#tarifs' : HUB_PATHS.pricing[lang], label: w.pricing, current: page === 'pricing' },
    { href: HUB_PATHS.help[lang], label: lang === 'fr' ? 'Aide' : 'Help', current: page === 'help' },
  ];
  return (
    <div lang={lang === 'fr' ? 'fr-CA' : 'en-CA'} className={styles.page}>
      <a href="#contenu" className={styles.skip}>{w.skip}</a>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <a className={styles.wordmark} href={home}><span>Food Hub<span className={styles.wordmarkDot}>.</span></span><small>{w.endorsement}</small></a>
          <nav className={styles.desktopNav} aria-label={w.nav}>{links.map((link) => <a key={link.href} href={link.href} aria-current={link.current ? 'page' : undefined}>{link.label}</a>)}</nav>
          <div className={styles.headerActions}>
            <a className={styles.language} href={HUB_PATHS[page][other]} hrefLang={other === 'fr' ? 'fr-CA' : 'en-CA'} lang={other}>{w.language}</a>
            <a href="/login" rel="nofollow" className={styles.login}>{w.login}<ArrowUpRight size={15} aria-hidden /></a>
            <details className={styles.mobileMenu}><summary aria-label={w.menu}><Menu size={21} aria-hidden /></summary><nav aria-label={w.nav}>{links.map((link) => <a key={link.href} href={link.href} aria-current={link.current ? 'page' : undefined}>{link.label}</a>)}</nav></details>
          </div>
        </div>
      </header>
      <main id="contenu">{children}</main>
      <aside className={styles.diner}><p>{w.diner}</p><a href="https://on2go.ca/">{w.dinerLink}<ArrowUpRight size={17} aria-hidden /></a></aside>
      <footer className={styles.footer}>
        <div className={styles.footerTop}><a className={styles.wordmark} href={home}><span>Food Hub<span className={styles.wordmarkDot}>.</span></span><small>{w.endorsement}</small></a><nav aria-label={w.support}><a href={HUB_PATHS.help[lang]}>{lang === 'fr' ? 'Aide Food Hub' : 'Food Hub help'}</a><a href={LEGAL_PATHS.support}>{w.support}</a><a href={LEGAL_PATHS.privacy}>{w.privacy}</a><a href={LEGAL_PATHS.terms}>{w.terms}</a></nav></div>
        <div className={styles.footerBottom}><p>{w.footerLine} {ctx.company}.<br />© {new Date().getFullYear()} {ctx.company} · {ctx.address}</p><p>{w.trademark}</p></div>
        <a href={contact} className={styles.supportEmail}>{publicSupportEmail(ctx.supportEmail)}</a>
        <CloverAppBadges apps={ctx.cloverApps ?? []} lang={lang} variant="compact" className={styles.cloverBadges} />
      </footer>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(hubJsonLd(page, lang, ctx)) }} />
    </div>
  );
}
