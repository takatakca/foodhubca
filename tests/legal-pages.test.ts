// Legal pages (privacy / terms / support, /legal index) — the URLs given to the Clover App Market.
// Owner decision sheet 2026-10-16, section 2a (code items outside lib/foodhub/phone/*).
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { proxy } from '../proxy';
import LegalLayout from '../app/legal/layout';
import LegalIndexPage from '../app/legal/page';
import PrivacyPage from '../app/legal/privacy/page';
import SupportPage from '../app/legal/support/page';
import TermsPage from '../app/legal/terms/page';
import { LISTING_DESCRIPTION, LISTING_FUNCTIONAL_DESCRIPTION } from '../lib/foodhub/clover-listing';
import { feesText, LEGAL_PATHS, legalInfo, phoneFeesText, TOKEN_DELETION } from '../lib/foodhub/legal';

const ENV_KEYS = [
  'SESSION_SECRET', 'DASHBOARD_PASSWORD', 'LIVE_CONNECTORS_GLOBAL_ENABLED', 'FOODHUB_LEGAL_APPROVED', 'FOODHUB_LEGAL_COMPANY',
  'FOODHUB_LEGAL_ADDRESS', 'FOODHUB_SUPPORT_EMAIL', 'FOODHUB_SUPPORT_PHONE', 'FOODHUB_PRIVACY_OFFICER', 'FOODHUB_LEGAL_UPDATED',
  'FOODHUB_TRIAL_DAYS', 'FOODHUB_MONTHLY_PRICE_CAD', 'FOODHUB_EXTRA_BRAND_PRICE_CAD',
  'FOODHUB_PHONE_TRIAL_DAYS', 'FOODHUB_PHONE_MONTHLY_PRICE_CAD', 'FOODHUB_PHONE_MINUTE_PRICE_CAD',
] as const;
const saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};
beforeEach(() => { for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; } });
afterEach(() => { for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

/** Renders a server page (plain function component) to text, tags removed and entities decoded. */
function text(page: () => ReactElement): string {
  return renderToStaticMarkup(createElement(page)).replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
}
const halves = (page: () => ReactElement) => {
  const html = renderToStaticMarkup(createElement(page));
  const at = html.indexOf('id="en"');
  expect(at).toBeGreaterThan(0);
  return { fr: html.slice(0, at), en: html.slice(at) };
};
/** One numbered section of one language half: from its "<h2>N." heading to the next heading. */
const section = (half: string, n: number) => {
  const start = half.search(new RegExp(`<h2[^>]*>${n}\\. `));
  expect(start).toBeGreaterThanOrEqual(0);
  const next = half.indexOf('<h2', start + 3);
  return half.slice(start, next < 0 ? undefined : next);
};

describe('/legal is public', () => {
  beforeEach(() => {
    process.env.SESSION_SECRET = 's'.repeat(64);
    process.env.DASHBOARD_PASSWORD = 'p'.repeat(16);
  });
  for (const path of ['/legal', '/legal/support', '/legal/privacy', '/legal/terms']) {
    it(`${path} answers without sign-in`, async () => {
      const res = await proxy(new NextRequest(`http://hub.local${path}`));
      expect(res.headers.get('x-middleware-next')).toBe('1');
      expect(res.status).toBe(200);
    });
  }
  it('look-alike paths still need a sign-in', async () => {
    for (const path of ['/legalx', '/legal-notes', '/api/legal']) {
      const res = await proxy(new NextRequest(`http://hub.local${path}`));
      expect(res.headers.get('x-middleware-next')).toBeNull();
      expect([307, 401]).toContain(res.status);
    }
  });
  it('/legal redirects to the support page', () => {
    let digest = '';
    try { LegalIndexPage(); } catch (e) { digest = String((e as { digest?: string }).digest ?? ''); }
    expect(digest).toContain('NEXT_REDIRECT');
    expect(digest).toContain(LEGAL_PATHS.support);
    expect(LEGAL_PATHS.index).toBe('/legal');
  });
});

describe('privacy policy (FR then EN)', () => {
  it('§1–2 cover the phone lines, texts, courier page and direct orders', () => {
    const { fr, en } = halves(PrivacyPage);
    for (const s of ['lignes téléphoniques', 'textos', 'livreurs', 'commandes directes', 'Clover Online Ordering', 'messagerie vocale', 'remboursements', 'adresse et ville du marchand']) expect(fr).toContain(s);
    for (const s of ['phone lines', 'texts', 'couriers', 'direct orders', 'Clover Online Ordering', 'voicemail', 'refunds', 'address and city']) expect(en).toContain(s);
    expect(section(fr, 2)).toContain('adresse courriel si elle est fournie');
    expect(section(fr, 2)).toContain('véhicule et position pendant la livraison');
    expect(section(en, 2)).toContain('email address if given');
    expect(section(en, 2)).toContain('vehicle and position during the delivery');
  });
  it('§1 covers both Clover apps: TAKATAK Food Hub and TAKATAK Phone (the automated phone assistant)', () => {
    const { fr, en } = halves(PrivacyPage);
    const fr1 = section(fr, 1);
    const en1 = section(en, 1);
    expect(fr1).toContain('à l’application Clover « TAKATAK Food Hub » et à l’application Clover « TAKATAK Phone », l’assistant téléphonique automatisé qui répond aux appels du restaurant, prend les commandes et envoie au client, par texto, un lien de paiement Clover');
    expect(en1).toContain('the “TAKATAK Food Hub” Clover app and the “TAKATAK Phone” Clover app, the automated phone assistant that answers the restaurant’s calls, takes orders and texts the customer a Clover payment link');
    expect(fr1).toContain('décrits à la section 2');
    expect(en1).toContain('described in section 2');
    // Both apps are named in the page header (the Clover App Market review opens the same URL for each app).
    expect(text(PrivacyPage)).toContain('TAKATAK Food Hub · TAKATAK Phone — Quadro Holdings LTEE');
  });
  it('§4 names every provider and the delivery services', () => {
    const { fr, en } = halves(PrivacyPage);
    for (const half of [fr, en]) {
      const s4 = section(half, 4);
      for (const s of ['Twilio', 'Anthropic', 'Google', 'Amazon (Polly)', 'Deepgram', 'MochaHost', 'Resend', 'Too Good To Go', 'DoorDash Drive', 'Uber Direct', 'SkipTheDishes', 'Supabase', 'Contabo', 'Slack']) expect(s4).toContain(s);
    }
    // No third-party aggregator is named as a provider (owner's rule: direct platform links only).
    for (const half of [fr, en]) expect(section(half, 4)).not.toContain('Deliverect');
    // The delivery services also receive the customer's email (dispatch.ts dropoff.email; Drive and Skip require it).
    expect(section(fr, 4)).toContain('nom, numéro et courriel du client, adresse de livraison et contenu de la commande');
    expect(section(en, 4)).toContain('the customer’s name, number and email, delivery address and order contents');
    // The default phone voices are Amazon Polly (lib/foodhub/phone/voices.ts DEFAULT_VOICES): keep Amazon named for the voices.
    expect(section(fr, 4)).toContain('Amazon (Polly) et Google pour les voix');
    expect(section(en, 4)).toContain('Amazon (Polly) and Google for the phone assistant’s voices');
    expect(fr).toContain('n’approuve de remboursement ou de paiement');
    expect(en).toContain('Neither one approves refunds or payments');
  });
  it('§5 says where data lives (US processors named, other providers outside Québec), no transfer assessment promise', () => {
    const { fr, en } = halves(PrivacyPage);
    const fr5 = section(fr, 5);
    const en5 = section(en, 5);
    expect(fr5).toContain('hébergée à Montréal');
    expect(en5).toContain('hosted in Montréal');
    expect(fr5).toContain('Twilio, d’Anthropic, de Google, d’Amazon et de Deepgram traitent les renseignements aux États-Unis');
    expect(en5).toContain('Twilio, Anthropic, Google, Amazon and Deepgram services process information in the United States');
    expect(fr5).toContain('à l’extérieur du Québec');
    expect(en5).toContain('outside Québec');
    expect(text(PrivacyPage)).not.toMatch(/nous évaluons|we assess/);
  });
  it('§6 gives the 30-day deletion and the token wording, no destruction promise', () => {
    const t = text(PrivacyPage);
    expect(t).toContain('dans les 30 jours');
    expect(t).toContain('within 30 days');
    expect(t).toContain(`Les jetons d’accès Clover d’un marchand ${TOKEN_DELETION.fr}.`);
    expect(t).toContain(`A merchant’s Clover access tokens ${TOKEN_DELETION.en}.`);
    expect(t).not.toMatch(/détruisons|destroy or anonymize/);
  });
  it('§8 covers deletion, complaints, the 30-day answer and press 0', () => {
    const { fr, en } = halves(PrivacyPage);
    const fr8 = section(fr, 8);
    const en8 = section(en, 8);
    for (const s of ['leur rectification, leur suppression, leur portabilité', 'plainte', 'Nous répondons par écrit dans les 30 jours', 'faites le 0']) expect(fr8).toContain(s);
    for (const s of ['access, correct, delete or port your information', 'complaint', 'We answer in writing within 30 days', 'press 0']) expect(en8).toContain(s);
  });
  it('wording rules: automated (never virtual), no round-the-clock claims', () => {
    const t = text(PrivacyPage) + text(TermsPage) + text(SupportPage);
    expect(t).not.toMatch(/virtuel|virtual|ghost|fantôme|24\s?h|24\/7/i);
  });
});

describe('terms and support', () => {
  it('terms §6 and the support FAQ: 14-day trial, then CAD $50 per month per app, billed only through Clover', () => {
    const t = halves(TermsPage);
    const s = halves(SupportPage);
    for (const fr of [section(t.fr, 6), s.fr]) {
      expect(fr).toContain('Essai gratuit de 14 jours, puis 50 $ CA par mois par application');
      expect(fr).toContain('rien n’est facturé en dehors de Clover');
      expect(fr).toContain('chaque marque additionnelle coûte 15 $ CA par mois par plateforme, facturés par Clover (le prix est affiché avant l’ajout)');
      expect(fr).not.toMatch(/sont gratuits/);
    }
    for (const en of [section(t.en, 6), s.en]) {
      expect(en).toContain('Free 14-day trial, then CAD $50 per month per app');
      expect(en).toContain('nothing is billed outside Clover');
      expect(en).toContain('each additional brand costs CAD $15 per month per platform, billed by Clover (the price is shown before you add it)');
      expect(en).not.toMatch(/account are free/);
    }
    expect(section(t.fr, 8)).toContain('par la facturation de Clover');
    expect(section(t.en, 8)).toContain('through Clover billing');
  });
  it('fees follow FOODHUB_TRIAL_DAYS / FOODHUB_MONTHLY_PRICE_CAD / FOODHUB_EXTRA_BRAND_PRICE_CAD; bad values fall back to the defaults', () => {
    process.env.FOODHUB_TRIAL_DAYS = '30';
    process.env.FOODHUB_MONTHLY_PRICE_CAD = '65';
    process.env.FOODHUB_EXTRA_BRAND_PRICE_CAD = '20';
    expect(text(TermsPage)).toContain('Free 30-day trial, then CAD $65 per month per app');
    expect(text(TermsPage)).toContain('each additional brand costs CAD $20 per month per platform');
    expect(text(SupportPage)).toContain('Essai gratuit de 30 jours, puis 65 $ CA par mois');
    expect(text(SupportPage)).toContain('chaque marque additionnelle coûte 20 $ CA par mois par plateforme');
    for (const bad of ['0', '-5', '12.5', 'abc', ' ']) {
      process.env.FOODHUB_TRIAL_DAYS = bad;
      process.env.FOODHUB_MONTHLY_PRICE_CAD = bad;
      process.env.FOODHUB_EXTRA_BRAND_PRICE_CAD = bad;
      expect(legalInfo().pricing).toEqual({ trialDays: 14, monthlyCad: 50, extraBrandCad: 15 });
    }
    expect(feesText({ trialDays: 14, monthlyCad: 50, extraBrandCad: 15 }).en).toContain('billed only through Clover App Market billing');
  });
  it('terms §1: the service is both apps; callers hear it is an automated assistant and can press 0', () => {
    const { fr, en } = halves(TermsPage);
    const fr1 = section(fr, 1);
    const en1 = section(en, 1);
    expect(fr1).toContain('et TAKATAK Phone, un assistant téléphonique automatisé qui répond aux appels du restaurant, prend les commandes et envoie au client, par texto, un lien de paiement Clover (ensemble, « le service »)');
    expect(fr1).toContain('L’appelant est informé qu’il parle à un assistant automatisé et peut faire le 0 pour parler à une personne.');
    expect(fr1).toContain('En installant l’une de ces applications Clover');
    expect(en1).toContain('and TAKATAK Phone, an automated phone assistant that answers the restaurant’s calls, takes orders and texts the customer a Clover payment link (together, “the service”)');
    expect(en1).toContain('Callers are told they are speaking with an automated assistant and can press 0 to speak with a person.');
    expect(en1).toContain('By installing either of these Clover apps');
    expect(section(fr, 11)).toContain('TAKATAK Food Hub et TAKATAK Phone sont des logiciels indépendants');
    expect(section(en, 11)).toContain('TAKATAK Food Hub and TAKATAK Phone are independent software');
  });
  it('terms §6 and the support FAQ: TAKATAK Phone is a 14-day trial, then CAD $50 per month plus CAD $0.25 per AI minute, Canada only', () => {
    const t = halves(TermsPage);
    const s = halves(SupportPage);
    for (const fr of [section(t.fr, 6), s.fr]) {
      expect(fr).toContain('<b>TAKATAK Food Hub.</b> Essai gratuit de 14 jours');
      expect(fr).toContain('<b>TAKATAK Phone.</b> Essai gratuit de 14 jours, puis 50 $ CA par mois, plus 0,25 $ CA par minute d’appel avec l’assistant automatisé.');
      expect(fr).toContain('Seul le temps où l’assistant est en ligne avec l’appelant est compté, arrondi à la minute supérieure pour chaque appel');
      expect(fr).toContain('le temps passé avec une personne du restaurant après un transfert n’est pas compté, et aucune minute n’est facturée pendant l’essai gratuit');
      expect(fr).toContain('facturé uniquement par Clover, par la facturation du Clover App Market');
      expect(fr).toContain('Offert au Canada seulement.');
    }
    for (const en of [section(t.en, 6), s.en]) {
      expect(en).toContain('<b>TAKATAK Food Hub.</b> Free 14-day trial');
      expect(en).toContain('<b>TAKATAK Phone.</b> Free 14-day trial, then CAD $50 per month, plus CAD $0.25 per minute of call with the automated assistant.');
      expect(en).toContain('Only the time the assistant is on the line with the caller is counted, rounded up to the next minute for each call');
      expect(en).toContain('time spent with a person from the restaurant after a transfer is not counted, and no minutes are billed during the free trial');
      expect(en).toContain('billed only through Clover App Market billing');
      expect(en).toContain('Offered in Canada only.');
    }
  });
  it('TAKATAK Phone fees follow FOODHUB_PHONE_TRIAL_DAYS / FOODHUB_PHONE_MONTHLY_PRICE_CAD / FOODHUB_PHONE_MINUTE_PRICE_CAD; bad values fall back', () => {
    expect(legalInfo().phonePricing).toEqual({ trialDays: 14, monthlyCad: 50, minuteCad: 0.25 });
    process.env.FOODHUB_PHONE_TRIAL_DAYS = '30';
    process.env.FOODHUB_PHONE_MONTHLY_PRICE_CAD = '60';
    process.env.FOODHUB_PHONE_MINUTE_PRICE_CAD = '0.3';
    expect(text(TermsPage)).toContain('Essai gratuit de 30 jours, puis 60 $ CA par mois, plus 0,30 $ CA par minute');
    expect(text(TermsPage)).toContain('Free 30-day trial, then CAD $60 per month, plus CAD $0.30 per minute');
    // The Food Hub price does not move with the phone variables.
    expect(text(SupportPage)).toContain('Essai gratuit de 14 jours, puis 50 $ CA par mois par application');
    process.env.FOODHUB_PHONE_MINUTE_PRICE_CAD = '1';
    expect(phoneFeesText(legalInfo().phonePricing).en).toContain('plus CAD $1 per minute');
    for (const bad of ['0', '-0.25', '0.255', 'abc', ' ']) {
      process.env.FOODHUB_PHONE_TRIAL_DAYS = bad;
      process.env.FOODHUB_PHONE_MONTHLY_PRICE_CAD = bad;
      process.env.FOODHUB_PHONE_MINUTE_PRICE_CAD = bad;
      expect(legalInfo().phonePricing).toEqual({ trialDays: 14, monthlyCad: 50, minuteCad: 0.25 });
    }
  });
  it('terms: customers’ personal information clause (service provider)', () => {
    const { fr, en } = halves(TermsPage);
    expect(fr).toContain('Renseignements personnels de vos clients');
    expect(fr).toContain('votre fournisseur de services');
    expect(en).toContain('Your customers’ personal information');
    expect(en).toContain('your service provider');
  });
  it('privacy §6, terms §9 and support use the exact same token wording', () => {
    expect(TOKEN_DELETION.fr).toBe('sont supprimés lorsque Clover nous avise de la désinstallation de l’application, ou sur demande');
    expect(TOKEN_DELETION.en).toBe('are deleted when Clover notifies us that the app was uninstalled, or on request');
    for (const page of [PrivacyPage, TermsPage, SupportPage]) {
      const t = text(page);
      expect(t).toContain(TOKEN_DELETION.fr);
      expect(t).toContain(TOKEN_DELETION.en);
      expect(t).not.toMatch(/de la désinstallation, ou sur demande/);
      expect(t).not.toMatch(/dès que Clover nous en avise|as soon as Clover notifies us|tokens are then deleted|jetons Clover sont alors supprimés/);
    }
  });
  it('the Clover App Market listing uses the same token wording as the legal pages (no "at once" promise)', () => {
    expect(LISTING_DESCRIPTION.fr).toContain(TOKEN_DELETION.fr);
    expect(LISTING_DESCRIPTION.en).toContain(TOKEN_DELETION.en);
    const all = [LISTING_DESCRIPTION.fr, LISTING_DESCRIPTION.en, LISTING_FUNCTIONAL_DESCRIPTION.fr, LISTING_FUNCTIONAL_DESCRIPTION.en].join(' ');
    expect(all).not.toMatch(/tokens at once|supprime aussitôt les jetons|deleted when the app is uninstalled|supprimés à la désinstallation/);
  });
});

describe('env-driven details and the draft banner', () => {
  it('company, address, officer, email and phone come from the environment (nothing hard-coded in the pages)', () => {
    const bare = text(PrivacyPage) + text(TermsPage) + text(SupportPage);
    expect(bare).toContain('[courriel à compléter — FOODHUB_SUPPORT_EMAIL]');
    expect(bare).toContain('[à compléter — FOODHUB_SUPPORT_PHONE]');
    expect(bare).not.toMatch(/\+?1?[ -]?\d{3}[ -]\d{3}[ -]\d{4}/); // no phone number unless FOODHUB_SUPPORT_PHONE is set
    process.env.FOODHUB_LEGAL_COMPANY = 'Example Co';
    process.env.FOODHUB_LEGAL_ADDRESS = '1 Test Street, Testville';
    process.env.FOODHUB_SUPPORT_EMAIL = 'help@example.test';
    process.env.FOODHUB_SUPPORT_PHONE = '+1 555-010-0000';
    process.env.FOODHUB_PRIVACY_OFFICER = 'Test Officer';
    process.env.FOODHUB_LEGAL_UPDATED = '2030-01-02';
    const t = text(PrivacyPage);
    for (const s of ['Example Co', '1 Test Street, Testville', 'help@example.test', '+1 555-010-0000', 'Test Officer', '2030-01-02']) expect(t).toContain(s);
    expect(text(SupportPage)).toContain('+1 555-010-0000');
  });
  it('shows the draft banner unless FOODHUB_LEGAL_APPROVED is exactly "true"', () => {
    const layout = () => LegalLayout({ children: createElement('p', null, 'body') });
    for (const v of [undefined, '', 'false', 'TRUE', '1']) {
      if (v === undefined) delete process.env.FOODHUB_LEGAL_APPROVED; else process.env.FOODHUB_LEGAL_APPROVED = v;
      expect(text(layout)).toContain('Projet à faire valider avant la publication');
    }
    process.env.FOODHUB_LEGAL_APPROVED = 'true';
    const approved = text(layout);
    expect(approved).not.toContain('Projet à faire valider');
    expect(approved).toContain('body');
  });
});
