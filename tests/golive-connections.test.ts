// MASTER_PLAN Phase 3 P2 leftovers: the Overview's Connections strip shows e-mail, SMS, the AI, the screens relay and the
// Too Good To Go mailbox (from the environment, owner-only setting names, never values); the Go-live ring and stepper
// come from the checklist; each celebration fires once per device.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createElement, type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { forViewer, serviceHealth, type ServiceHealth } from '../lib/foodhub/connections';
import { buildHealth } from '../lib/foodhub/health';
import { hashPassword } from '../lib/foodhub/auth';
import { getRepo } from '../lib/foodhub/repo';
import { CELEBRATION_KEYS, claimCelebration, markCelebrated, type CelebrationStore } from '../lib/ui/celebrate';
import { ServicesStrip } from '../components/live/services-strip';
import { ProgressRing } from '../components/ui/progress-ring';
import { I18nProvider } from '../lib/i18n/client';
import { goLiveProgress, goLiveStages, type Step } from '@/app/(console)/settings/go-live/steps';

const KEYS = [
  'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'SMTP_PORT', 'RESEND_API_KEY', 'AUTH_EMAIL_FROM', 'REPORT_EMAIL_FROM',
  'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM', 'TWILIO_MESSAGING_SERVICE_SID', 'ANTHROPIC_API_KEY',
  'FOODHUB_SCREENS_AGENT_TOKEN', 'TGTG_IMAP_HOST', 'TGTG_IMAP_USER', 'TGTG_IMAP_PASSWORD', 'TGTG_EMAIL_WEBHOOK_SECRET',
  'FOODHUB_FORCE_MEMORY', 'CRON_SECRET', 'DASHBOARD_PASSWORD',
];
const saved: Record<string, string | undefined> = {};
const env = (vars: Record<string, string | undefined>) => {
  for (const [k, v] of Object.entries(vars)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
};
beforeEach(() => {
  for (const k of KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  env({ FOODHUB_FORCE_MEMORY: 'true', CRON_SECRET: 'cron-test-secret', DASHBOARD_PASSWORD: 'Owner-pass-123' });
  (globalThis as { __foodhubMem?: unknown }).__foodhubMem = undefined;
});
afterEach(() => { env(saved); });

const row = (rows: ServiceHealth[], key: string) => rows.find((r) => r.key === key);
const SECRETS = { SMTP_PASS: 'smtp-pass-not-shown-1', TWILIO_AUTH_TOKEN: 'twilio-token-not-shown-2', ANTHROPIC_API_KEY: 'ai-key-not-shown-3' };

describe('Connections strip: e-mail, SMS, AI from the environment', () => {
  it('nothing set: three rows, "off", with the names of what to add', () => {
    const rows = serviceHealth();
    expect(rows.map((r) => r.key)).toEqual(['email', 'sms', 'ai']);
    expect(row(rows, 'email')).toMatchObject({ status: 'off', missing: ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'AUTH_EMAIL_FROM'] });
    expect(row(rows, 'sms')).toMatchObject({ status: 'off', missing: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM'] });
    expect(row(rows, 'ai')).toMatchObject({ status: 'off', missing: ['ANTHROPIC_API_KEY'] });
  });

  it('everything set: "ok", nothing missing, and no value ever appears', () => {
    env({ SMTP_HOST: 'smtp.example.test', SMTP_USER: 'orders', ...SECRETS, AUTH_EMAIL_FROM: 'Food Hub <codes@example.test>', TWILIO_ACCOUNT_SID: 'AC-test', TWILIO_FROM: '+15550000000' });
    const rows = serviceHealth();
    expect(rows.map((r) => [r.key, r.status, r.missing.length])).toEqual([['email', 'ok', 0], ['sms', 'ok', 0], ['ai', 'ok', 0]]);
    const text = JSON.stringify(rows);
    for (const v of [...Object.values(SECRETS), 'smtp.example.test', 'codes@example.test', '+15550000000']) expect(text).not.toContain(v);
  });

  it('half set up is "warn" with only what is left: Resend without a sender, texts without a calling number', () => {
    env({ RESEND_API_KEY: 'resend-test', TWILIO_ACCOUNT_SID: 'AC-test', TWILIO_AUTH_TOKEN: 'tok', TWILIO_MESSAGING_SERVICE_SID: 'MG-test' });
    const rows = serviceHealth();
    expect(row(rows, 'email')).toMatchObject({ status: 'warn', missing: ['AUTH_EMAIL_FROM'] });
    expect(row(rows, 'sms')).toMatchObject({ status: 'warn', missing: ['TWILIO_FROM'] });
    // An SMTP mailbox started: only its missing parts.
    env({ RESEND_API_KEY: undefined, SMTP_HOST: 'smtp.example.test', AUTH_EMAIL_FROM: 'codes@example.test' });
    expect(row(serviceHealth(), 'email')).toMatchObject({ status: 'off', missing: ['SMTP_USER', 'SMTP_PASS'] });
  });
});

describe('Connections strip: screens relay and Too Good To Go mailbox, only once set up', () => {
  const now = Date.parse('2026-10-30T15:00:00Z');
  const screen = (lastSeenAt: string | null, state: string | null = 'ok') => ({ id: Math.random().toString(36), name: 's', platform: 'ubereats', locationCode: 'X', lastSeenAt, state }) as never;

  it('relay: too-short token, no screen yet, all reporting, silent, mixed', () => {
    env({ FOODHUB_SCREENS_AGENT_TOKEN: 'short' });
    expect(row(serviceHealth({ now }), 'screens')).toMatchObject({ status: 'warn', missing: ['FOODHUB_SCREENS_AGENT_TOKEN'] });
    env({ FOODHUB_SCREENS_AGENT_TOKEN: 'relay-token-long-enough-for-tests-0001' });
    expect(row(serviceHealth({ now, screens: [] }), 'screens')).toMatchObject({ status: 'warn', missing: [] });
    const fresh = new Date(now - 20_000).toISOString();
    const old = new Date(now - 10 * 60_000).toISOString();
    expect(row(serviceHealth({ now, screens: [screen(fresh), screen(fresh)] }), 'screens')?.status).toBe('ok');
    expect(row(serviceHealth({ now, screens: [screen(old), screen(null)] }), 'screens')).toMatchObject({ status: 'warn', detail: 'No heartbeat from the relay host.' });
    expect(row(serviceHealth({ now, screens: [screen(fresh), screen(fresh, 'login')] }), 'screens')?.detail).toContain('1 of 2');
  });

  it('mailbox: half set, read on time, failing, late, switched off, webhook only', () => {
    expect(row(serviceHealth({ now }), 'tgtg_email')).toBeUndefined();
    env({ TGTG_IMAP_HOST: 'imap.example.test' });
    expect(row(serviceHealth({ now }), 'tgtg_email')).toMatchObject({ status: 'warn', missing: ['TGTG_IMAP_USER', 'TGTG_IMAP_PASSWORD'] });
    env({ TGTG_IMAP_USER: 'orders@example.test', TGTG_IMAP_PASSWORD: 'imap-pass-not-shown' });
    const ok = serviceHealth({ now, mailbox: { lastOkAt: new Date(now - 2 * 60_000).toISOString() } });
    expect(row(ok, 'tgtg_email')).toMatchObject({ status: 'ok', detail: 'Mailbox read 2 min ago.' });
    expect(JSON.stringify(ok)).not.toContain('imap-pass-not-shown');
    expect(JSON.stringify(ok)).not.toContain('imap.example.test');
    const failing = row(serviceHealth({ now, mailbox: { lastOkAt: new Date(now).toISOString(), lastError: 'imap.example.test refused' } }), 'tgtg_email');
    expect(failing?.status).toBe('warn');
    expect(JSON.stringify(failing)).not.toContain('imap.example.test');
    expect(row(serviceHealth({ now, mailbox: { lastOkAt: new Date(now - 60 * 60_000).toISOString() } }), 'tgtg_email')?.status).toBe('warn');
    expect(row(serviceHealth({ now, tgtgEnabled: false }), 'tgtg_email')?.status).toBe('off');
    env({ TGTG_IMAP_HOST: undefined, TGTG_IMAP_USER: undefined, TGTG_IMAP_PASSWORD: undefined, TGTG_EMAIL_WEBHOOK_SECRET: 'hook-secret' });
    expect(row(serviceHealth({ now }), 'tgtg_email')?.status).toBe('ok');
  });

  it('the strip renders every row with its state word (English and French)', () => {
    env({ RESEND_API_KEY: 'resend-test', AUTH_EMAIL_FROM: 'codes@example.test', FOODHUB_SCREENS_AGENT_TOKEN: 'relay-token-long-enough-for-tests-0001', TGTG_EMAIL_WEBHOOK_SECRET: 'hook' });
    const services = serviceHealth({ now, screens: [] });
    const en = renderToStaticMarkup(createElement(I18nProvider, { lang: 'en' } as ComponentProps<typeof I18nProvider>, createElement(ServicesStrip, { services })));
    for (const name of ['E-mail', 'SMS &amp; calls', 'AI (Claude)', 'Screens relay', 'Too Good To Go e-mails']) expect(en).toContain(name);
    expect(en).toContain('ready'); expect(en).toContain('not set up'); expect(en).toContain('needs a look');
    expect(en).toContain('ANTHROPIC_API_KEY'); // the owner's copy carries the names
    const fr = renderToStaticMarkup(createElement(ServicesStrip, { services: forViewer(services, 'manager') }));
    for (const name of ['Courriel', 'SMS et appels', 'IA (Claude)', 'Relais des écrans', 'Courriels Too Good To Go']) expect(fr).toContain(name);
    expect(fr).not.toContain('ANTHROPIC_API_KEY');
  });
});

describe('/api/health carries the services without changing the status; names for the owner only', () => {
  it('buildHealth: services beside the checks, never inside them', async () => {
    const h = await buildHealth();
    expect(h.services.map((s) => s.key)).toEqual(['email', 'sms', 'ai']);
    expect(Object.keys(h.checks).sort()).toEqual(['clover', 'console', 'database', 'inbox', 'recovery', 'sync', 'watchtower']);
    env({ FOODHUB_SCREENS_AGENT_TOKEN: 'relay-token-long-enough-for-tests-0001' });
    const h2 = await buildHealth();
    expect(h2.services.map((s) => s.key)).toEqual(['email', 'sms', 'ai', 'screens']);
    expect(h2.status).toBe(h.status);
  });

  it('owner: the names of missing settings; manager and cron secret: the states only; public: nothing', async () => {
    const { GET } = await import('../app/api/health/route');
    const basic = (u: string, p: string) => `Basic ${Buffer.from(`${u}:${p}`).toString('base64')}`;
    const ask = async (authorization?: string) => (await GET(new Request('http://hub.local/api/health', { headers: authorization ? { authorization } : {} }))).json();
    const owner = await ask(basic('owner', 'Owner-pass-123'));
    expect(owner.services.find((s: ServiceHealth) => s.key === 'ai').missing).toEqual(['ANTHROPIC_API_KEY']);
    await getRepo().saveUser({ username: 'gerant', name: 'Gérant', role: 'manager', locations: [], passwordHash: hashPassword('manager-pass-1'), active: true } as never);
    const manager = await ask(basic('gerant', 'manager-pass-1'));
    expect(manager.services.map((s: ServiceHealth) => s.status)).toEqual(['off', 'off', 'off']);
    expect(manager.services.every((s: ServiceHealth) => s.missing.length === 0)).toBe(true);
    const cron = await ask('Bearer cron-test-secret');
    expect(cron.services.every((s: ServiceHealth) => s.missing.length === 0)).toBe(true);
    const anyone = await ask();
    expect(anyone.services).toBeUndefined();
  });
});

describe('Go-live ring and stepper, from the checklist', () => {
  const s = (group: string, state: Step['state'], optional?: boolean) => ({ group, state, optional });

  it('the ring is the share of the steps to do that are done; « À vérifier » and « Optionnel » never hold it back', () => {
    expect(goLiveProgress([])).toEqual({ percent: 0, ready: 0, counted: 0, todo: 0, complete: false });
    expect(goLiveProgress([s('A', 'done'), s('A', 'todo'), s('A', 'warn'), s('A', 'warn', true)])).toMatchObject({ percent: 50, ready: 1, counted: 2, todo: 1, complete: false });
    expect(goLiveProgress([s('A', 'done'), s('A', 'done'), s('A', 'warn')])).toMatchObject({ percent: 100, complete: true });
    // 199 of 200: never rounded up to a false 100 %.
    const many = [...Array.from({ length: 199 }, () => s('A', 'done')), s('A', 'todo')];
    expect(goLiveProgress(many)).toMatchObject({ percent: 99, complete: false });
  });

  it('one stage per group: done, to check, the current one, then the next ones', () => {
    const stages = goLiveStages([
      s('Fondations', 'done'), s('Fondations', 'done'),
      s('Alertes', 'done'), s('Alertes', 'warn', true),
      s('Équipe', 'done'), s('Équipe', 'warn'),
      s('Cuisine', 'todo'), s('Cuisine', 'done'),
      s('Plateformes', 'todo'),
    ]);
    expect(stages.map((x) => [x.group, x.state])).toEqual([['Fondations', 'done'], ['Alertes', 'done'], ['Équipe', 'check'], ['Cuisine', 'current'], ['Plateformes', 'todo']]);
    expect(stages[3]).toMatchObject({ ready: 1, counted: 2 });
  });

  it('the shared ring says its value in words and clamps it', () => {
    const html = renderToStaticMarkup(createElement(ProgressRing, { value: 1.7, label: '100 %', ariaLabel: 'Prêt à 100 %', size: 'lg' }));
    expect(html).toContain('aria-label="Prêt à 100 %"');
    expect(html).toContain('stroke-dashoffset="0"');
    expect(renderToStaticMarkup(createElement(ProgressRing, { value: 0, label: '0/3', ariaLabel: '0 sur 3' }))).not.toContain('stroke-go');
  });
});

describe('a celebration fires once per device', () => {
  const memoryStore = (): CelebrationStore & { data: Map<string, string> } => {
    const data = new Map<string, string>();
    return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); } };
  };

  it('first time true, then false on this device; another device celebrates its own once', () => {
    const device = memoryStore();
    expect(claimCelebration(CELEBRATION_KEYS.goLive, device)).toBe(true);
    expect(claimCelebration(CELEBRATION_KEYS.goLive, device)).toBe(false);
    expect(claimCelebration(CELEBRATION_KEYS.goLive, device)).toBe(false);
    expect(claimCelebration(CELEBRATION_KEYS.goLive, memoryStore())).toBe(true);
    // Each moment has its own key.
    expect(claimCelebration(CELEBRATION_KEYS.cloverConnected, device)).toBe(true);
  });

  it('a moment that passed without a celebration never fires later', () => {
    const device = memoryStore();
    markCelebrated(CELEBRATION_KEYS.firstPublish, device);
    expect(claimCelebration(CELEBRATION_KEYS.firstPublish, device)).toBe(false);
  });

  it('blocked storage (private mode): still once, remembered for the tab, and nothing throws', () => {
    const blocked: CelebrationStore = { getItem: () => { throw new Error('SecurityError'); }, setItem: () => { throw new Error('SecurityError'); } };
    expect(claimCelebration('takatak.celebrated.test-blocked', blocked)).toBe(true);
    expect(claimCelebration('takatak.celebrated.test-blocked', blocked)).toBe(false);
    expect(claimCelebration('takatak.celebrated.test-none', null)).toBe(true);
    expect(claimCelebration('takatak.celebrated.test-none', null)).toBe(false);
  });
});
