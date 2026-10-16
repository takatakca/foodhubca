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
import { LEGAL_PATHS } from '../lib/foodhub/legal';

const ENV_KEYS = [
  'SESSION_SECRET', 'DASHBOARD_PASSWORD', 'LIVE_CONNECTORS_GLOBAL_ENABLED', 'FOODHUB_LEGAL_APPROVED', 'FOODHUB_LEGAL_COMPANY',
  'FOODHUB_LEGAL_ADDRESS', 'FOODHUB_SUPPORT_EMAIL', 'FOODHUB_SUPPORT_PHONE', 'FOODHUB_PRIVACY_OFFICER', 'FOODHUB_LEGAL_UPDATED',
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
  });
  it('§4 names every provider and the delivery services', () => {
    const { fr, en } = halves(PrivacyPage);
    for (const half of [fr, en]) {
      for (const s of ['Twilio', 'Anthropic', 'Google', 'MochaHost', 'DoorDash Drive', 'Uber Direct', 'SkipTheDishes', 'Supabase', 'Contabo', 'Slack']) expect(half).toContain(s);
    }
    expect(fr).toContain('n’approuve de remboursement ou de paiement');
    expect(en).toContain('Neither one approves refunds or payments');
  });
  it('§5 says where data lives and no longer promises a transfer assessment', () => {
    const t = text(PrivacyPage);
    expect(t).toContain('hébergée à Montréal');
    expect(t).toContain('hosted in Montréal');
    expect(t).toMatch(/aux États-Unis/);
    expect(t).toMatch(/in the United States/);
    expect(t).not.toMatch(/nous évaluons|we assess/);
  });
  it('§6 gives the 30-day deletion and the token wording, no destruction promise', () => {
    const t = text(PrivacyPage);
    expect(t).toContain('dans les 30 jours');
    expect(t).toContain('within 30 days');
    expect(t).toContain('lorsque Clover nous avise de la désinstallation de l’application, ou sur demande');
    expect(t).toContain('when Clover notifies us that the app was uninstalled, or on request');
    expect(t).not.toMatch(/détruisons|destroy or anonymize/);
  });
  it('§8 covers deletion, complaints, the 30-day answer and press 0', () => {
    const { fr, en } = halves(PrivacyPage);
    for (const s of ['suppression', 'plainte', 'Nous répondons par écrit dans les 30 jours', 'faites le 0']) expect(fr).toContain(s);
    for (const s of ['delete', 'complaint', 'We answer in writing within 30 days', 'press 0']) expect(en).toContain(s);
  });
  it('wording rules: automated (never virtual), no round-the-clock claims', () => {
    const t = text(PrivacyPage) + text(TermsPage) + text(SupportPage);
    expect(t).not.toMatch(/virtuel|virtual|ghost|fantôme|24\s?h|24\/7/i);
  });
});

describe('terms and support', () => {
  it('terms §6: service and account free, nothing billed outside Clover', () => {
    const { fr, en } = halves(TermsPage);
    expect(fr).toContain('Le service et le compte Food Hub sont gratuits');
    expect(fr).toContain('rien n’est facturé en dehors de Clover');
    expect(en).toContain('The service and the Food Hub account are free');
    expect(en).toContain('nothing is billed outside Clover');
  });
  it('terms: customers’ personal information clause (service provider)', () => {
    const { fr, en } = halves(TermsPage);
    expect(fr).toContain('Renseignements personnels de vos clients');
    expect(fr).toContain('votre fournisseur de services');
    expect(en).toContain('Your customers’ personal information');
    expect(en).toContain('your service provider');
  });
  it('terms §9 and support use the same token wording', () => {
    for (const page of [TermsPage, SupportPage]) {
      const t = text(page);
      expect(t).toContain('jetons d’accès Clover sont supprimés lorsque Clover nous avise de la désinstallation, ou sur demande');
      expect(t).toContain('Clover access tokens are deleted when Clover notifies us that the app was uninstalled, or on request');
      expect(t).not.toMatch(/dès que Clover nous en avise|as soon as Clover notifies us|tokens are then deleted|jetons Clover sont alors supprimés/);
    }
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
