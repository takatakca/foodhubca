import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mail = vi.hoisted(() => ({ sent: [] as Array<{ to: string; subject: string; text: string }> }));
vi.mock('../lib/foodhub/notify', async (original) => ({ ...(await original<typeof import('../lib/foodhub/notify')>()), sendEmail: async (message: { to: string; subject: string; text: string }) => { mail.sent.push(message); return { ok: true, channel: 'email', message: 'isolated email transport' }; } }));
import { HubPage } from '../components/public-hub/hub-page';
import { HUB_PATHS, hubMetadata, hubPageAt, hubPageMarketUrl, hubSitemap, type HubContext } from '../lib/foodhub/public-hub';
import { getRepo } from '../lib/foodhub/repo';
import { LEADS, LEAD_MAX_BODY_BYTES, listLeads, resetLeadRateLimit } from '../lib/foodhub/restaurant-leads';
import { POST } from '../app/api/public/restaurant-leads/route';

const context: HubContext = { base: 'https://foodhub.on2go.ca', appMarketUrl: null, cloverApps: [], sameAs: [], supportEmail: null, company: 'Company Example', address: 'Montréal, Canada', marketStatus: 'review', livePlatforms: [] };
const payload = (extra: Record<string, unknown> = {}) => ({ restaurant: 'Local kitchen', contact: 'Test Owner', email: 'owner@example.test', phone: '5145550123', city: 'Montréal', province: 'QC', platforms: ['uber', 'phone'], lang: 'en', source: 'foodhub', company: '', ...extra });
const request = (body = payload(), key?: string, headers: Record<string, string> = {}) => new Request('https://foodhub.on2go.ca/api/public/restaurant-leads', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://foodhub.on2go.ca', ...(key ? { 'idempotency-key': key } : {}), ...headers }, body: JSON.stringify(body) });

beforeEach(() => { vi.stubEnv('FOODHUB_FORCE_MEMORY', 'true'); vi.stubEnv('FOODHUB_SUPPORT_EMAIL', 'support@example.test'); (globalThis as unknown as { __foodhubMem?: unknown }).__foodhubMem = undefined; resetLeadRateLimit(); mail.sent = []; });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe('bilingual native merchant contact', () => {
  it.each(['fr', 'en'] as const)('renders a discoverable, labelled request form with a safe email fallback (%s)', (lang) => {
    const path = HUB_PATHS.contact[lang];
    const html = renderToStaticMarkup(createElement(HubPage, { page: 'contact', lang, ctx: context }));
    expect(hubPageAt(path)).toEqual({ key: 'contact', lang });
    expect(hubMetadata('contact', lang, context).alternates?.canonical).toBe(`${context.base}${path}`);
    expect(hubSitemap(context.base, false, []).some((entry) => entry.url === `${context.base}${path}`)).toBe(true);
    expect(hubPageMarketUrl('contact', { appMarketUrl: 'https://www.clover.com/foodhub', cloverApps: [] })).toBeNull();
    expect(html).toContain('method="post"');
    expect(html).toContain('action="/api/public/restaurant-leads"');
    expect(html).toMatch(/<fieldset[^>]*disabled=""/);
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled=""/);
    expect(html).toContain('<noscript>');
    expect(html).toContain('href="mailto:support@takatak.ca"');
    expect(html).toContain(lang === 'fr' ? 'pas à des messages promotionnels' : 'does not subscribe you to promotional messages');
    for (const name of ['restaurant', 'contact', 'email', 'phone', 'city', 'province', 'brands', 'website', 'message']) expect(html).toContain(`id="enquiry-${name}"`);
    expect(html).not.toContain('localStorage');
  });
  it('stores a real Food Hub enquiry and uses product-appropriate optional emails without an unsupported deadline', async () => {
    const response = await POST(request());
    expect(response.status).toBe(202); expect(await response.json()).toEqual({ ok: true });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('access-control-allow-origin')).toBeNull(); // same-origin needs no CORS expansion
    expect(await listLeads()).toEqual([expect.objectContaining({ source: 'foodhub', lang: 'en', status: 'new', phone: '+15145550123' })]);
    expect(mail.sent).toHaveLength(2);
    expect(mail.sent[0].subject).toContain('[Food Hub]'); expect(mail.sent[1].subject).toContain('Food Hub');
    expect(mail.sent[1].text).not.toMatch(/list .*Local kitchen|two business days|deux jours|subscri/i);
    expect(mail.sent[1].text).toContain('setup');
    expect((await listLeads())[0]).not.toHaveProperty('marketingConsent');
  });
  it('preserves the separate Phone AI enquiry context through the form and its language twin', () => {
    const html = renderToStaticMarkup(createElement(HubPage, { page: 'contact', lang: 'en', ctx: context, contactInterest: 'phone' }));
    expect(html).toContain('TAKATAK PHONE AI');
    expect(html).toMatch(/name="platforms"[^>]*checked=""[^>]*value="phone"|name="platforms"[^>]*value="phone"[^>]*checked=""/);
    expect(html).toContain('href="/hub/contact?interest=phone"');
    expect(html).not.toContain('Install TAKATAK Phone AI');
  });
  it('replays a stored request after response loss without another lead/email or spending another quota slot', async () => {
    const key = 'contact-replay-0000000001';
    expect((await POST(request(payload(), key))).status).toBe(202);
    for (let i = 0; i < 8; i++) expect((await POST(request(payload(), key))).status).toBe(202);
    expect(await listLeads()).toHaveLength(1); expect(mail.sent).toHaveLength(2);
    const changed = await POST(request(payload({ restaurant: 'Different restaurant' }), key));
    expect(changed.status).toBe(409); expect(await changed.json()).toEqual({ ok: false, error: 'request_changed' });
    expect(mail.sent).toHaveLength(2);
  });
  it('keeps two concurrent submissions under one durable request claim', async () => {
    const responses = await Promise.all([POST(request(payload(), 'concurrent-contact-0001')), POST(request(payload(), 'concurrent-contact-0001'))]);
    expect(responses.map((response) => response.status).sort()).toEqual(expect.arrayContaining([202]));
    expect(responses.every((response) => [202, 409].includes(response.status))).toBe(true);
    expect((await POST(request(payload(), 'concurrent-contact-0001'))).status).toBe(202);
    expect(await listLeads()).toHaveLength(1); expect(mail.sent).toHaveLength(2);
  });
  it('acknowledges a verified committed storage write even if its response was lost, without duplicating or inventing email success', async () => {
    const repo = getRepo(); const original = repo.putDocs.bind(repo);
    const spy = vi.spyOn(repo, 'putDocs').mockImplementation(async (collection, docs) => { await original(collection, docs); if (collection === LEADS) throw new Error('simulated lost database acknowledgement'); });
    expect((await POST(request(payload(), 'storage-response-lost-01'))).status).toBe(202);
    spy.mockRestore();
    expect((await POST(request(payload(), 'storage-response-lost-01'))).status).toBe(202);
    expect(await listLeads()).toHaveLength(1); expect(mail.sent).toHaveLength(0);
  });
  it('preserves acceptance after an optional post-storage activity failure', async () => {
    vi.spyOn(getRepo(), 'addActivity').mockRejectedValue(new Error('isolated activity failure'));
    expect((await POST(request(payload(), 'activity-write-failed-01'))).status).toBe(202);
    expect((await POST(request(payload(), 'activity-write-failed-01'))).status).toBe(202);
    expect(await listLeads()).toHaveLength(1); expect(mail.sent).toHaveLength(2);
  });
  it('does not accept a nondurable production enquiry or expose storage implementation details', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const response = await POST(request(payload(), 'production-unavailable-01'));
    expect(response.status).toBe(503); expect(await response.json()).toEqual({ ok: false, error: 'unavailable' });
    expect(await listLeads()).toHaveLength(0); expect(mail.sent).toHaveLength(0);
  });
  it('holds an unconfirmed write rather than creating another lead on retry', async () => {
    const repo = getRepo();
    const spy = vi.spyOn(repo, 'putDocs').mockRejectedValue(new Error('storage unavailable'));
    expect((await POST(request(payload(), 'pending-write-00000001'))).status).toBe(503);
    spy.mockRestore();
    const retry = await POST(request(payload(), 'pending-write-00000001'));
    expect(retry.status).toBe(409); expect(await retry.json()).toEqual({ ok: false, error: 'request_pending' });
    expect(await listLeads()).toHaveLength(0); expect(mail.sent).toHaveLength(0);
  });
  it('keeps the old ON2GO cross-origin contract without an idempotency header', async () => {
    const response = await POST(request(payload({ source: 'on2go.ca', lang: 'fr' }), undefined, { origin: 'https://on2go.ca' }));
    expect(response.status).toBe(202); expect(response.headers.get('access-control-allow-origin')).toBe('https://on2go.ca');
    expect(mail.sent[1].subject).toContain('ON2GO'); expect(mail.sent[1].text).toContain('inscrire');
    expect(mail.sent[1].text).not.toMatch(/deux jours|two business days/);
  });
  it('requires the actual JSON media type and rejects malformed optional request keys before storing', async () => {
    expect((await POST(request(payload(), undefined, { 'content-type': 'text/plain; application/json' }))).status).toBe(415);
    expect((await POST(request(payload(), 'short'))).status).toBe(400);
    expect(await listLeads()).toHaveLength(0);
  });
  it('rejects website URLs containing credentials before storing or emailing them', async () => {
    for (const website of ['https://example-user@example.test', 'https://example-user:example-password@example.test']) {
      const response = await POST(request(payload({ website })));
      expect(response.status).toBe(400); expect(await response.json()).toEqual({ ok: false, errors: { website: 'invalid' } });
    }
    expect(await listLeads()).toHaveLength(0); expect(mail.sent).toHaveLength(0);
  });
  it('stops an undeclared oversized streaming body at the byte boundary', async () => {
    let cancelled = false; let pulls = 0;
    const stream = new ReadableStream<Uint8Array>({ pull(controller) { pulls++; controller.enqueue(new Uint8Array(8000)); if (pulls === 100) controller.close(); }, cancel() { cancelled = true; } });
    const init = { method: 'POST', headers: { 'content-type': 'application/json' }, body: stream, duplex: 'half' } as RequestInit & { duplex: 'half' };
    const response = await POST(new Request('https://foodhub.on2go.ca/api/public/restaurant-leads', init));
    expect(response.status).toBe(413); expect(cancelled).toBe(true); expect(pulls).toBeLessThan(10);
    expect(LEAD_MAX_BODY_BYTES).toBe(16000); expect(await listLeads()).toHaveLength(0);
  });
});
