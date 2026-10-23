// Premium A3 review (round 1): what the owner reads on Money, Go-live and Clover app is honest and plain (FR / EN).
// Setting names, commands, docs paths and raw codes go under « Détails techniques », never in the sentence or badge.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { translator } from '@/lib/i18n';
import { settledCard, type OrderRecon, type ReconStatus } from '@/app/(console)/money/money-ui';
import { alertSteps, cloverAppSteps, stepBadge, stepTally, stepText, tallyLine, type Step } from '@/app/(console)/settings/go-live/steps';
import { cloverAppSetupText, meteringTech, webhookKeyBadge } from '@/app/(console)/settings/clover-app/apps-text';
import { Section } from '@/app/(console)/settings/settings-ui';
import { hasTech } from '@/app/(console)/settings/tech-text';

const fr = translator('fr');
const en = translator('en');
const order = (status: ReconStatus): OrderRecon => ({ status } as OrderRecon);
const orders = (...s: ReconStatus[]) => s.map(order);

describe('Money: the green « Tout est réglé » card only when every order was checked', () => {
  it('orders whose payout is not due yet keep a neutral card that says so (7 days, yesterday, end of 30 days)', () => {
    const r = { imports: 3, orders: orders('matched', 'pending', 'pending') };
    expect(settledCard(fr, r)).toEqual({ settled: false, title: 'Versements pas encore dus', body: '2 commandes attendent leur versement, pas encore dû.' });
    expect(settledCard(en, r)).toEqual({ settled: false, title: 'Payouts not due yet', body: '2 orders are waiting for their payout, not due yet.' });
    expect(settledCard(fr, { imports: 1, orders: orders('pending') }).body).toBe('1 commande attend son versement, pas encore dû.');
    expect(settledCard(en, { imports: 1, orders: orders('pending') }).body).toBe('1 order is waiting for its payout, not due yet.');
  });

  it('orders no statement covers yet, alone or with payouts not due yet', () => {
    expect(settledCard(fr, { imports: 1, orders: orders('not_covered', 'matched') })).toEqual({ settled: false, title: 'Rien à récupérer pour l’instant', body: '1 commande pas encore couverte par un relevé.' });
    expect(settledCard(en, { imports: 1, orders: orders('not_covered', 'not_covered', 'pending') })).toEqual({ settled: false, title: 'Nothing to recover so far', body: '2 orders not covered by a statement yet. 1 order is waiting for its payout, not due yet.' });
  });

  it('no statement imported: not checked yet, whatever the orders say', () => {
    for (const o of [orders('matched'), orders('pending'), []]) {
      expect(settledCard(fr, { imports: 0, orders: o })).toEqual({ settled: false, title: 'Pas encore vérifié', body: 'Importez un relevé pour vérifier cette période.' });
      expect(settledCard(en, { imports: 0, orders: o }).title).toBe('Not checked yet');
    }
  });

  it('green only when every order was checked against a statement and nothing is missing', () => {
    const r = { imports: 2, orders: orders('matched', 'cancelled', 'over_paid') };
    expect(settledCard(fr, r)).toMatchObject({ settled: true, title: 'Tout est réglé' });
    expect(settledCard(en, r)).toMatchObject({ settled: true, title: 'All settled', body: 'Every order in this period was checked against a statement: no money to recover.' });
    // A period without any order is not "all settled": there was nothing to check.
    expect(settledCard(fr, { imports: 2, orders: [] })).toEqual({ settled: false, title: 'Aucune commande', body: 'Aucune commande dans cette période : rien à vérifier.' });
    expect(settledCard(en, { imports: 2, orders: [] }).settled).toBe(false);
  });
});

describe('Go-live: optional steps say « Optionnel », steps to look at say « À vérifier »', () => {
  const warn = (over: Partial<Step> = {}): Step => ({ key: 'k', state: 'warn', title: 'T', body: 'B.', href: '/', cta: 'Voir', group: 'G', ...over });

  it('the badge word, in French and English', () => {
    expect(stepBadge(fr, warn({ optional: true }))).toEqual({ tone: 'info', word: 'Optionnel' });
    expect(stepBadge(en, warn({ optional: true }))).toEqual({ tone: 'info', word: 'Optional' });
    expect(stepBadge(fr, warn())).toEqual({ tone: 'wait', word: 'À vérifier' });
    expect(stepBadge(en, warn())).toEqual({ tone: 'wait', word: 'To check' });
    expect(stepBadge(fr, warn({ state: 'todo' })).word).toBe('À faire');
    // Done is done, optional or not.
    expect(stepBadge(fr, warn({ state: 'done', optional: true }))).toEqual({ tone: 'go', word: 'Prêt' });
  });

  it('the team chat, the AI explanations and the Clover app keys are optional, and say so with the text folded away', () => {
    const steps = [...alertSteps({ email: true, sms: true, call: true, chat: false, ai: false }, fr), ...cloverAppSteps({ app: { configured: false, merchants: [] } }, fr)];
    const by = (k: string) => steps.find((s) => s.key === k)!;
    for (const k of ['chat', 'ai', 'clover-app']) expect(stepBadge(fr, by(k)).word).toBe('Optionnel');
    // The chat step's body is only a setting name: the word "optional" stays in the visible sentence.
    expect(stepText(fr, by('chat'))).toEqual({ plain: 'Optionnel : un réglage du serveur, fait par votre technicien si vous le voulez.', tech: 'Clavardage de l’équipe — Optionnel : ALERT_WEBHOOK_URL (Slack, Teams, Google Chat).' });
    expect(stepText(en, alertSteps({ email: true, sms: true, call: true, chat: false, ai: false }, en).find((s) => s.key === 'chat')!).plain).toBe('Optional: a server setting, done by your technician if you want it.');
    expect(stepText(fr, by('clover-app')).plain).toMatch(/^Optionnel : /);
    expect(stepText(fr, by('ai')).plain).toBe('Sans clé, les règles intégrées expliquent les alertes.');
    for (const k of ['chat', 'ai', 'clover-app']) expect(hasTech(stepText(fr, by(k)).plain)).toBe(false);
    // Sign-in emails and texts are not optional.
    const off = alertSteps({ email: false, sms: false, call: false, chat: true, ai: true }, fr);
    expect(off.filter((s) => s.state === 'todo').map((s) => s.key)).toEqual(['email', 'sms']);
    expect(stepText(fr, off[0]).plain).toBe('Un réglage du serveur, fait par votre technicien.');
  });

  it('a step that needs a look stays « À vérifier » (webhook, legal drafts, listing)', () => {
    const steps = cloverAppSteps({ app: { configured: true, merchants: [] }, webhookAuthSet: false }, fr);
    for (const k of ['clover-hook', 'legal', 'clover-listing']) expect(stepBadge(fr, steps.find((s) => s.key === k)!).word).toBe('À vérifier');
    expect(stepText(fr, steps.find((s) => s.key === 'legal')!).plain).toBe('Brouillons publics à faire relire.');
  });

  it('the counter keeps optional steps apart', () => {
    const n = stepTally([warn({ optional: true }), warn({ optional: true }), warn(), warn({ state: 'todo' }), warn({ state: 'done' })]);
    expect(n).toEqual({ done: 1, todo: 1, check: 1, optional: 2 });
    expect(tallyLine(fr, n)).toBe('1 à faire · 1 à vérifier · 2 optionnels');
    expect(tallyLine(en, n)).toBe('1 to do · 1 to check · 2 optional');
    expect(tallyLine(fr, { done: 0, todo: 2, check: 0, optional: 1 })).toBe('2 à faire · 0 à vérifier · 1 optionnel');
    expect(tallyLine(fr, { done: 3, todo: 0, check: 0, optional: 0 })).toBe('0 à faire · 0 à vérifier');
  });
});

describe('Clover app: « Applications Clover de ce serveur » in plain words', () => {
  const phone = { key: 'phone' as const, missing: ['CLOVER_PHONE_APP_ID', 'CLOVER_PHONE_APP_SECRET'], env: { webhookAuth: 'CLOVER_PHONE_WEBHOOK_AUTH' }, webhookAuthSet: false };
  const foodhub = { key: 'foodhub' as const, missing: ['CLOVER_CLIENT_ID'], env: { webhookAuth: 'CLOVER_WEBHOOK_AUTH' }, webhookAuthSet: true };

  it('the set-up sentence has no setting name, guide path or command; the technician gets them all', () => {
    for (const t of [fr, en]) for (const a of [phone, foodhub]) expect(hasTech(cloverAppSetupText(t, a).plain)).toBe(false);
    expect(cloverAppSetupText(fr, phone)).toEqual({
      plain: 'Créez l’application dans le tableau de bord Clover, puis demandez à votre technicien de poser ses clés sur le serveur. Sans elles, rien ne change.',
      tech: 'CLOVER_PHONE_APP_ID, CLOVER_PHONE_APP_SECRET, CLOVER_PHONE_WEBHOOK_AUTH · docs/CLOVER_MULTI_APP.md',
    });
    expect(cloverAppSetupText(en, phone).plain).toBe('Create the app in the Clover dashboard, then ask your technician to put its keys on the server. Without them, nothing changes.');
    expect(cloverAppSetupText(fr, foodhub)).toEqual({ plain: 'Les clés de l’application ne sont pas encore sur le serveur : votre technicien les pose.', tech: 'CLOVER_CLIENT_ID · npm run setup' });
    expect(cloverAppSetupText(en, foodhub).plain).toBe('The app keys are not on the server yet: your technician sets them.');
  });

  it('the webhook badge is a word; the setting name only folds away when it is missing', () => {
    expect(webhookKeyBadge(fr, phone)).toEqual({ ok: false, word: 'Clé du webhook manquante', tech: 'CLOVER_PHONE_WEBHOOK_AUTH' });
    expect(webhookKeyBadge(en, phone)).toEqual({ ok: false, word: 'Webhook key missing', tech: 'CLOVER_PHONE_WEBHOOK_AUTH' });
    expect(webhookKeyBadge(fr, foodhub)).toEqual({ ok: true, word: 'Clé du webhook en place' });
    expect(webhookKeyBadge(en, foodhub)).toEqual({ ok: true, word: 'Webhook key set' });
    expect(meteringTech({ enabled: 'FOODHUB_CLOVER_PHONE_METERED_ENABLED', meteredId: 'CLOVER_PHONE_METERED_ID', exempt: 'FOODHUB_BILLING_EXEMPT_MERCHANTS' }))
      .toBe('CLOVER_PHONE_METERED_ID · FOODHUB_CLOVER_PHONE_METERED_ENABLED=true · FOODHUB_BILLING_EXEMPT_MERCHANTS');
  });

  it('the section itself never writes a setting name, a guide path or a command into the owner text', () => {
    const src = readFileSync(path.join(process.cwd(), 'app/(console)/settings/clover-app/page.tsx'), 'utf8');
    const section = src.slice(src.indexOf('function CloverAppsSection'), src.indexOf('type TestStep'));
    expect(section.length).toBeGreaterThan(1000);
    expect(section).not.toMatch(/\.env\.\w+/);
    expect(section).not.toMatch(/\.missing\.join|docs\/|npm run/);
  });
});

describe('Section: technical details sit after the subtitle, never inside its <p>', () => {
  const html = (props: Record<string, unknown>) => renderToStaticMarkup(createElement(Section, { title: 'Titre', ...props } as never, 'corps'));

  it('renders the details as a block after the paragraph', () => {
    const out = html({ subtitle: 'Une phrase simple.', tech: 'FOODHUB_PUBLIC_URL' });
    expect(out).toMatch(/<p [^>]*>Une phrase simple\.<\/p><details/);
    expect(out).toContain('FOODHUB_PUBLIC_URL');
    expect(out).not.toMatch(/<p [^>]*>(?:(?!<\/p>).)*<details/s);
  });

  it('a section without `tech` renders exactly as before', () => {
    const out = html({ subtitle: 'Une phrase simple.' });
    expect(out).not.toContain('<details');
    expect(out).toMatch(/<div class="min-w-0"><h2 [^>]*>Titre<\/h2><p [^>]*>Une phrase simple\.<\/p><\/div>/);
  });

  it('no page passes a « Détails techniques » block into a subtitle (a <p>)', () => {
    const files: string[] = [];
    const walk = (dir: string) => { for (const f of readdirSync(dir)) { const p = path.join(dir, f); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith('.tsx')) files.push(p); } };
    walk(path.join(process.cwd(), 'app'));
    walk(path.join(process.cwd(), 'components'));
    const bad = files.filter((f) => readFileSync(f, 'utf8').split('\n').some((l) => /(?:subtitle|intro)=\{[^\n]*<TechDetails/.test(l)));
    expect(bad).toEqual([]);
  });
});
