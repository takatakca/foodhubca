import Image from 'next/image';
import { ArrowRight, ArrowUpRight, Check, ChevronRight, Headphones, Layers3, Phone, Store } from 'lucide-react';
import { publicSupportHref } from '@/lib/foodhub/public-support';
import { EXTRA_BRAND_PLATFORM_CAD, FOOD_HUB_APP_NAME, formatCadLabel, PHONE_APP_NAME, PHONE_MINUTE_CAD, PHONE_MONTHLY_CAD, PHONE_TRIAL_DAYS, STANDARD_MONTHLY_CAD, TRIAL_DAYS, type Lang } from '@/lib/foodhub/pricing';
import { fillHub, HUB_CONTENT, HUB_PATHS, hubFaq, hubPageMarketUrl, type HubContext, type HubPageKey } from '@/lib/foodhub/public-hub';
import type { Block } from '@/lib/foodhub/public-hub-content';
import { RESTAURANT_COPY } from './restaurant-copy';
import { RestaurantShell } from './restaurant-shell';
import shared from './restaurant-landing.module.css';
import styles from './restaurant-details.module.css';

type DetailPage = Exclude<HubPageKey, 'landing' | 'contact'>;
const contactHref = (ctx: HubContext) => publicSupportHref(ctx.supportEmail);

function Plan({ phone, lang, ctx }: { phone: boolean; lang: Lang; ctx: HubContext }) {
  const fr = lang === 'fr';
  const w = RESTAURANT_COPY[lang];
  const name = phone ? PHONE_APP_NAME : FOOD_HUB_APP_NAME;
  const url = hubPageMarketUrl(phone ? 'phone' : 'pricing', ctx);
  return (
    <article className={styles.plan}>
      <p className={shared.eyebrow}>{phone ? (fr ? 'COMMANDES PAR TÉLÉPHONE' : 'PHONE ORDERS') : (fr ? 'OPÉRATIONS DE LIVRAISON' : 'DELIVERY OPERATIONS')}</p>
      <h3>{name}</h3>
      <div className={styles.planPrice}><strong>{formatCadLabel(phone ? PHONE_MONTHLY_CAD : STANDARD_MONTHLY_CAD, lang)}</strong><span>{w.monthly}</span></div>
      <p className={styles.planTrial}>{phone ? PHONE_TRIAL_DAYS : TRIAL_DAYS} {w.trial}</p>
      <ul>
        {phone ? <>
          <li><Check size={16} aria-hidden /><span>{fr ? 'Application et abonnement distincts de Food Hub.' : 'A separate app and subscription from Food Hub.'}</span></li>
          <li><Check size={16} aria-hidden /><span>{fr ? 'Menu, ligne et transfert configurés pour votre restaurant.' : 'Menu, line and transfer configured for your restaurant.'}</span></li>
        </> : <>
          <li><Check size={16} aria-hidden /><span>{w.priceIncludes}</span></li>
          <li><Check size={16} aria-hidden /><span>{fr ? 'Espaces par plateforme, marque et établissement.' : 'Workspaces by platform, brand and location.'}</span></li>
        </>}
      </ul>
      <div className={styles.planExtra}><b>+ {formatCadLabel(phone ? PHONE_MINUTE_CAD : EXTRA_BRAND_PLATFORM_CAD, lang)}</b><p>{phone ? (fr ? 'par minute d’IA, arrondie par appel. Consultez la définition des minutes.' : 'per AI minute, rounded per call. See how minutes are defined.') : w.extra}</p></div>
      <a className={shared.primary} href={url ?? `${HUB_PATHS.contact[lang]}${phone ? '?interest=phone' : ''}`}>{url ? (fr ? `Installer ${name}` : `Install ${name}`) : phone ? (fr ? 'Parler de mon service téléphonique' : 'Discuss my phone service') : w.contact}<ArrowUpRight size={18} aria-hidden /></a>
      <p className={styles.planStatus}>{url ? (fr ? 'Installation sur le Clover App Market.' : 'Install through the Clover App Market.') : (!phone && ctx.marketStatus === 'soon') ? w.soon : (fr ? `${name} : fiche en révision chez Clover.` : `${name}: listing under review by Clover.`)}</p>
      <p className={styles.planTerms}>{fr ? 'Canada seulement. Taxes en sus. Essai, abonnement et frais supplémentaires facturés par Clover. Prix en vigueur dans la fiche App Market à l’installation.' : 'Canada only. Plus applicable taxes. Trial, subscription and additional charges are managed by Clover. Current prices appear in the App Market listing at installation.'}</p>
      {phone && <a className={shared.textLink} href={`${HUB_PATHS.phone[lang]}#minutes`}>{fr ? 'Comment les minutes sont comptées' : 'How minutes are counted'}<ArrowRight size={15} aria-hidden /></a>}
    </article>
  );
}

function DetailBlock({ block, lang, ctx }: { block: Block; lang: Lang; ctx: HubContext }) {
  const fr = lang === 'fr';
  if (block.kind === 'pricing') {
    const product = block.product ?? 'both';
    return <section className={styles.block} id={block.id} aria-labelledby={`${block.id}-title`}><p className={shared.eyebrow}>{fr ? 'ABONNEMENTS CLOVER' : 'CLOVER SUBSCRIPTIONS'}</p><h2 id={`${block.id}-title`}>{block.title}</h2><div className={`${styles.planGrid}${product !== 'both' ? ` ${styles.singlePlan}` : ''}`}>{product !== 'phone' && <Plan phone={false} lang={lang} ctx={ctx} />}{product !== 'foodhub' && <Plan phone lang={lang} ctx={ctx} />}</div></section>;
  }
  if (block.kind === 'cards') return <section className={styles.block} id={block.id} aria-labelledby={`${block.id}-title`}><h2 id={`${block.id}-title`}>{block.title}</h2>{block.intro && <p className={styles.blockLead}>{block.intro}</p>}<div className={`${styles.cards}${block.cards.length === 3 ? ` ${styles.threeCards}` : ''}`}>{block.cards.map((card, i) => <article key={card.title}><span className={styles.number}>0{i + 1}</span><h3>{card.title}</h3><p>{fillHub(card.text, lang, ctx)}</p></article>)}</div></section>;
  if (block.kind === 'steps') return <section className={styles.block} id={block.id} aria-labelledby={`${block.id}-title`}><p className={shared.eyebrow}>{fr ? 'CONFIGURATION & VÉRIFICATION' : 'SETUP & VERIFICATION'}</p><h2 id={`${block.id}-title`}>{block.title}</h2><ol className={styles.steps}>{block.steps.map((step, i) => <li key={step.title}><span className={styles.stepNumber}>0{i + 1}</span><h3>{step.title}</h3><p>{fillHub(step.text, lang, ctx)}</p></li>)}</ol></section>;
  if (block.kind === 'text') return <section className={`${styles.block} ${styles.prose}`} id={block.id} aria-labelledby={`${block.id}-title`}><h2 id={`${block.id}-title`}>{block.title}</h2><div>{block.paragraphs.map((paragraph) => <p key={paragraph}>{fillHub(paragraph, lang, ctx)}</p>)}{['soutien', 'support'].includes(block.id) && <a href={contactHref(ctx)} className={shared.textLink}>{fr ? 'Contacter le soutien' : 'Contact support'}<ArrowUpRight size={17} aria-hidden /></a>}</div></section>;
  if (block.kind === 'links') return <section className={styles.block} id={block.id} aria-labelledby={`${block.id}-title`}><h2 id={`${block.id}-title`}>{block.title}</h2><div className={styles.related}>{block.pages.map((key) => <a key={key} href={HUB_PATHS[key][lang]}><span>{HUB_CONTENT[key][lang].label}</span><ArrowUpRight size={18} aria-hidden /><p>{HUB_CONTENT[key][lang].description}</p>{HUB_CONTENT[key][lang].platform && <small>{fr ? 'Selon les accès autorisés' : 'Subject to authorized access'}</small>}</a>)}</div></section>;
  return null;
}

function HeroAside({ page, lang }: { page: DetailPage; lang: Lang }) {
  const fr = lang === 'fr';
  if (page === 'kitchen') return <figure className={styles.kitchenPreview}><Image src={`/hub-media/foodhub-product-demo-${lang}.jpg`} alt={fr ? 'Capture de démonstration du parcours de commande Food Hub.' : 'Food Hub order-flow demonstration capture.'} width={1920} height={1080} priority sizes="(min-width: 900px) 43vw, 100vw" /><figcaption>{fr ? 'Capture réelle de Food Hub en démonstration. Commande fictive.' : 'Actual Food Hub demonstration capture. Fictional order.'}</figcaption></figure>;
  const provider = page === 'uber' ? 'Uber Eats' : page === 'doordash' ? 'DoorDash' : page === 'skip' ? 'SkipTheDishes' : null;
  const Icon = page === 'phone' ? Phone : page === 'help' ? Headphones : Layers3;
  const points = page === 'phone'
    ? [fr ? 'Une ligne configurée' : 'A configured line', fr ? 'Votre menu et vos options' : 'Your menu and options', fr ? 'Clover et votre cuisine' : 'Clover and your kitchen']
    : page === 'help'
      ? [fr ? 'Vos comptes marchands' : 'Your merchant accounts', fr ? 'Vos accès disponibles' : 'Your available access', fr ? 'Votre configuration vérifiée' : 'Your verified setup']
      : page === 'pricing'
        ? [fr ? 'Première marque incluse' : 'First brand included', fr ? 'Marques supplémentaires par plateforme' : 'Additional brands by platform', fr ? 'Téléphone sur un abonnement distinct' : 'Phone on a separate subscription']
        : [provider!, 'Food Hub', fr ? 'Clover & cuisine' : 'Clover & kitchen'];
  return <aside className={styles.heroAside}><Icon size={30} strokeWidth={1.35} aria-hidden /><p className={styles.asideEyebrow}>{page === 'phone' ? PHONE_APP_NAME : provider ? (fr ? 'PARCOURS À CONFIGURER' : 'FLOW TO CONFIGURE') : 'FOOD HUB'}</p><ol>{points.map((point, i) => <li key={point}><span>0{i + 1}</span>{point}</li>)}</ol><p className={styles.asideNote}>{page === 'phone' ? (fr ? 'Un appel test vérifie la ligne, le parcours Clover et le transfert vers votre équipe avant l’activation.' : 'A test call checks the line, Clover flow and hand-off to your team before activation.') : provider ? (fr ? 'Les fonctions connectées dépendent des autorisations de la plateforme et des vérifications de votre restaurant.' : 'Connected features depend on platform authorization and verification of your restaurant’s setup.') : (fr ? 'Des préalables clairs avant l’activation. Une configuration adaptée à votre restaurant.' : 'Clear requirements before activation. A setup built around your restaurant.')}</p></aside>;
}

export function RestaurantDetails({ page, lang, ctx }: { page: DetailPage; lang: Lang; ctx: HubContext }) {
  const fr = lang === 'fr';
  const c = HUB_CONTENT[page][lang];
  const w = RESTAURANT_COPY[lang];
  const market = hubPageMarketUrl(page, ctx);
  const primary = market ?? (page === 'help' ? contactHref(ctx) : `${HUB_PATHS.contact[lang]}${page === 'phone' ? '?interest=phone' : ''}`);
  const action = market ? (page === 'phone' ? (fr ? `Installer ${PHONE_APP_NAME}` : `Install ${PHONE_APP_NAME}`) : w.install) : page === 'help' ? (fr ? 'Contacter le soutien' : 'Contact support') : page === 'phone' ? (fr ? 'Parler de mon service téléphonique' : 'Discuss my phone service') : w.contact;
  const faq = hubFaq(page, lang, ctx);
  return <RestaurantShell page={page} lang={lang} ctx={ctx}>
    <div className={styles.container}>
      <nav className={styles.breadcrumb} aria-label={fr ? 'Fil d’Ariane' : 'Breadcrumb'}><a href={HUB_PATHS.landing[lang]}>Food Hub</a><ChevronRight size={13} aria-hidden /><span aria-current="page">{c.label}</span></nav>
      <section className={styles.hero} aria-labelledby="detail-title"><div><p className={shared.eyebrow}>{c.eyebrow}</p><h1 id="detail-title">{c.h1}</h1><p className={styles.lead}>{fillHub(c.lead, lang, ctx)}</p><div className={styles.actions}><a className={shared.primary} href={primary}>{action}<ArrowUpRight size={18} aria-hidden /></a><a className={shared.textLink} href={page === 'pricing' || page === 'help' ? `#${c.blocks[0].id}` : HUB_PATHS.pricing[lang]}>{page === 'pricing' ? (fr ? 'Comparer les abonnements' : 'Compare subscriptions') : page === 'help' ? (fr ? 'Préparer ma configuration' : 'Prepare my setup') : w.priceDetail}<ArrowRight size={17} aria-hidden /></a></div>{c.platform && <p className={styles.activation}><Store size={15} aria-hidden />{fr ? 'Accès autorisés et configuration vérifiée avant l’activation.' : 'Authorized access and verified setup before activation.'}</p>}</div><HeroAside page={page} lang={lang} /></section>
      {c.blocks.map((block) => <DetailBlock key={block.id} block={block} lang={lang} ctx={ctx} />)}
      <section className={`${styles.block} ${styles.faq}`} aria-labelledby="faq-title"><div><p className={shared.eyebrow}>{fr ? 'LES RÉPONSES UTILES' : 'USEFUL ANSWERS'}</p><h2 id="faq-title">{fr ? 'Avant de continuer.' : 'Before you continue.'}</h2></div><div className={shared.questions}>{faq.map((question) => <details key={question.q}><summary>{question.q}<span aria-hidden>+</span></summary><p>{question.a}</p></details>)}</div></section>
    </div>
    <section className={shared.final} aria-labelledby="contact-title"><div><p className={shared.eyebrow}>{fr ? 'VOTRE RESTAURANT, VOTRE CONFIGURATION' : 'YOUR RESTAURANT, YOUR SETUP'}</p><h2 id="contact-title">{fr ? 'Parlons de vos\nopérations.' : 'Let’s talk about\nyour operation.'}</h2></div><div><p>{page === 'phone' ? (fr ? 'Votre ligne, votre menu, votre équipe. Faisons le point sur les préalables et le parcours téléphonique.' : 'Your line, your menu, your team. Let’s review the requirements and phone-ordering flow.') : w.finalText}</p><a className={shared.primary} href={page === 'help' ? contactHref(ctx) : `${HUB_PATHS.contact[lang]}${page === 'phone' ? '?interest=phone' : ''}`}>{page === 'help' ? (fr ? 'Contacter le soutien' : 'Contact support') : w.contact}<ArrowUpRight size={18} aria-hidden /></a></div></section>
  </RestaurantShell>;
}
