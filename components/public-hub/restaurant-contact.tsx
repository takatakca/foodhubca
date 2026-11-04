import { ArrowUpRight, Check, ChevronRight } from 'lucide-react';
import type { Lang } from '@/lib/foodhub/pricing';
import { HUB_CONTENT, HUB_PATHS, hubFaq, type HubContext } from '@/lib/foodhub/public-hub';
import { publicSupportEmail, publicSupportHref } from '@/lib/foodhub/public-support';
import { RestaurantShell } from './restaurant-shell';
import { RestaurantContactForm } from './restaurant-contact-form';
import shared from './restaurant-landing.module.css';
import styles from './restaurant-contact.module.css';

export function RestaurantContact({ lang, ctx, interest }: { lang: Lang; ctx: HubContext; interest?: 'phone' }) {
  const fr = lang === 'fr';
  const c = HUB_CONTENT.contact[lang];
  const faq = hubFaq('contact', lang, ctx);
  const email = publicSupportEmail(ctx.supportEmail);
  return <RestaurantShell page="contact" lang={lang} ctx={ctx} contactInterest={interest}>
    <div className={styles.container}>
      <nav className={styles.breadcrumb} aria-label={fr ? 'Fil d’Ariane' : 'Breadcrumb'}><a href={HUB_PATHS.landing[lang]}>Food Hub</a><ChevronRight size={13} aria-hidden /><span aria-current="page">{c.label}</span></nav>
      <header className={styles.intro}><p className={shared.eyebrow}>{c.eyebrow}</p><h1>{c.h1}</h1><p>{c.lead}</p></header>
      <div className={styles.layout}>
        <section className={styles.formCard} id="demande" aria-labelledby="request-title">{interest === 'phone' && <p className={shared.eyebrow}>TAKATAK PHONE AI</p>}<h2 id="request-title">{c.blocks[0].title}</h2><RestaurantContactForm lang={lang} supportEmail={email} interest={interest} /></section>
        <aside className={styles.aside}>
          <p className={shared.eyebrow}>{fr ? 'UNE DISCUSSION UTILE' : 'A USEFUL CONVERSATION'}</p><h2>{fr ? 'Partons de vos opérations.' : 'Start with your operation.'}</h2>
          <ul>{(fr ? ['Vos marques et vos établissements', 'Vos plateformes et votre caisse', 'Votre parcours de commande et de cuisine'] : ['Your brands and locations', 'Your platforms and register', 'Your order and kitchen workflow']).map((point) => <li key={point}><Check size={17} aria-hidden />{point}</li>)}</ul>
          <p>{fr ? 'Vos accès restent entre vos mains. Ne transmettez aucun mot de passe, code de connexion ou renseignement de paiement.' : 'You stay in control of your accounts. Do not send passwords, sign-in codes or payment information.'}</p>
          <div className={styles.email}><h3>{fr ? 'Vous préférez nous écrire?' : 'Prefer to email us?'}</h3><a href={publicSupportHref(email)}>{email}<ArrowUpRight size={16} aria-hidden /></a><p>{fr ? 'Vous pouvez aussi copier cette adresse.' : 'You can also copy this address.'}</p></div>
        </aside>
      </div>
      <section className={styles.faq} aria-labelledby="contact-faq-title"><h2 id="contact-faq-title">{fr ? 'Avant de continuer.' : 'Before you continue.'}</h2><div className={shared.questions}>{faq.map((item) => <details key={item.q}><summary>{item.q}<span aria-hidden>+</span></summary><p>{item.a}</p></details>)}</div></section>
    </div>
  </RestaurantShell>;
}
