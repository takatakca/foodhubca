// Restaurant leads: the ON2GO.ca "Join / get listed" form → POST /api/public/restaurant-leads → Settings → Restaurant leads.
// Validation, honeypot, CORS (on2go.ca only), per-IP quota, storage + listing (newest first, status, notes), emails
// skipped without a provider, owner-only console route.
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  allowLead, LEAD_RATE_MAX, leadAutoReplyText, leadCorsHeaders, leadNotificationText, leadOrigin, listLeads, notifyLead, parseLead,
  resetLeadRateLimit, saveLead, updateLead,
} from '../lib/foodhub/restaurant-leads';
import { getRepo } from '../lib/foodhub/repo';
import { resetThrottle } from '../lib/foodhub/session';

const ORIGIN = 'https://on2go.ca';
const URL_ = 'http://hub.local/api/public/restaurant-leads';
const valid = () => ({
  restaurant: 'Chez Mimi', contact: 'Mimi Tremblay', email: 'Mimi@Example.com', phone: '(514) 555-0199', city: 'Montréal',
  address: '123 rue Test', website: 'chezmimi.example', platforms: ['uber', 'direct'], brands: 2, message: 'On veut être sur ON2GO.', lang: 'fr', source: 'on2go.ca', company: '',
});
const post = (body: unknown, headers: Record<string, string> = {}, ip?: string) =>
  new Request(URL_, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), headers: { 'content-type': 'application/json', origin: ORIGIN, ...(ip ? { 'x-forwarded-for': ip } : {}), ...headers } });

async function clearLeads() {
  const repo = getRepo();
  const docs = await repo.listDocs('restaurant_leads');
  if (docs.length) await repo.deleteDocs('restaurant_leads', docs.map((d) => d.id));
}

beforeEach(async () => { resetLeadRateLimit(); resetThrottle(); await clearLeads(); });
afterEach(() => { delete process.env.FOODHUB_SUPPORT_EMAIL; delete process.env.FOODHUB_TRUST_PROXY; delete process.env.DASHBOARD_PASSWORD; delete process.env.SESSION_SECRET; });

describe('parseLead (validation)', () => {
  it('accepts a complete form and normalises email, phone and website', () => {
    const r = parseLead(valid());
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(r.lead.email).toBe('mimi@example.com');
    expect(r.lead.phone).toBe('+15145550199');
    expect(r.lead.website).toBe('https://chezmimi.example');
    expect(r.lead.platforms).toEqual(['uber', 'direct']);
    expect(r.lead.brands).toBe(2);
    expect(r.lead.lang).toBe('fr');
    expect(r.lead.source).toBe('on2go.ca');
  });

  it('refuses missing or malformed fields, one error key per field', () => {
    const r = parseLead({ ...valid(), restaurant: ' ', email: 'not-an-email', phone: '12', platforms: 'uber', brands: 0, lang: 'de', website: 'nope' });
    expect(r.kind).toBe('invalid');
    if (r.kind !== 'invalid') return;
    expect(r.errors).toEqual({ restaurant: 'required', email: 'invalid', phone: 'invalid', platforms: 'invalid', brands: 'invalid', lang: 'invalid', website: 'invalid' });
    const empty = parseLead({});
    expect(empty.kind).toBe('invalid');
    if (empty.kind === 'invalid') expect(empty.errors).toMatchObject({ restaurant: 'required', contact: 'required', city: 'required', email: 'required', phone: 'required', platforms: 'invalid' });
  });

  it('enforces the length limits (message 2000, restaurant 120) and strips control characters', () => {
    const r = parseLead({ ...valid(), message: 'x'.repeat(2001), restaurant: 'y'.repeat(121) });
    expect(r.kind).toBe('invalid');
    if (r.kind === 'invalid') expect(r.errors).toEqual({ message: 'too_long', restaurant: 'too_long' });
    const ok = parseLead({ ...valid(), contact: 'Mi\u0000mi\u0007 T' });
    expect(ok.kind).toBe('ok');
    if (ok.kind === 'ok') expect(ok.lead.contact).toBe('Mimi T');
  });

  it('optional fields may be absent; unknown platforms are dropped; lang defaults to fr; brands is optional', () => {
    const r = parseLead({ restaurant: 'Resto', contact: 'A B', email: 'a@b.ca', phone: '4385550100', city: 'Laval', platforms: ['skip', 'bogus', 'skip'] });
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(r.lead).toMatchObject({ platforms: ['skip'], lang: 'fr', source: 'on2go.ca' });
    expect(r.lead.address).toBeUndefined();
    expect(r.lead.website).toBeUndefined();
    expect(r.lead.brands).toBeUndefined();
    expect(r.lead.message).toBeUndefined();
  });

  it('honeypot: any value in "company" is a bot', () => {
    expect(parseLead({ ...valid(), company: 'Acme' }).kind).toBe('honeypot');
    expect(parseLead({ ...valid(), company: ' ' }).kind).toBe('ok');
    expect(parseLead({ company: 'x' }).kind).toBe('honeypot'); // before validation: the bot sees no field errors
  });
});

describe('CORS', () => {
  it('allows on2go.ca and www.on2go.ca only (no localhost, no partners, no http)', () => {
    expect(leadOrigin('https://on2go.ca')).toBe('https://on2go.ca');
    expect(leadOrigin('https://www.on2go.ca/')).toBe('https://www.on2go.ca');
    expect(leadOrigin('http://on2go.ca')).toBeNull();
    expect(leadOrigin('https://qmaps.ca')).toBeNull();
    expect(leadOrigin('http://localhost:3000')).toBeNull();
    expect(leadOrigin('https://on2go.ca.evil.example')).toBeNull();
    expect(leadOrigin(null)).toBeNull();
    expect(leadCorsHeaders('https://on2go.ca')).toMatchObject({ 'Access-Control-Allow-Origin': 'https://on2go.ca', 'Access-Control-Allow-Methods': 'POST, OPTIONS', Vary: 'Origin' });
    expect(leadCorsHeaders('https://evil.example')).toEqual({ Vary: 'Origin' });
  });
});

describe('per-IP quota', () => {
  it(`allows ${LEAD_RATE_MAX} submissions per window per IP, then refuses until the window passes`, () => {
    const t0 = 1_000_000;
    for (let i = 0; i < LEAD_RATE_MAX; i++) expect(allowLead('1.2.3.4', t0 + i)).toBe(true);
    expect(allowLead('1.2.3.4', t0 + 10)).toBe(false);
    expect(allowLead('5.6.7.8', t0 + 10)).toBe(true); // another IP is not affected
    expect(allowLead('1.2.3.4', t0 + 10 * 60_000 + 1)).toBe(true); // window passed
  });
});

describe('POST /api/public/restaurant-leads', () => {
  it('is public (proxy lets it through), answers 202 with CORS, stores the lead newest first', async () => {
    const { proxy } = await import('../proxy');
    process.env.DASHBOARD_PASSWORD = 'Owner-pass-123';
    process.env.SESSION_SECRET = 's'.repeat(32);
    expect((await proxy(new NextRequest(URL_, { method: 'POST' }))).headers.get('x-middleware-next')).toBe('1');

    const { POST, OPTIONS } = await import('../app/api/public/restaurant-leads/route');
    const res = await POST(post(valid()));
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ ok: true });
    expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    expect(res.headers.get('cache-control')).toBe('no-store');

    const second = await POST(post({ ...valid(), restaurant: 'Deuxième' }));
    expect(second.status).toBe(202);
    const leads = await listLeads();
    expect(leads.map((l) => l.restaurant)).toEqual(['Deuxième', 'Chez Mimi']);
    expect(leads[1]).toMatchObject({ status: 'new', notes: '', email: 'mimi@example.com', phone: '+15145550199', lang: 'fr', source: 'on2go.ca' });
    expect(leads[1].id).toMatch(/^[0-9a-f-]{36}$/);

    const pre = await OPTIONS(new Request(URL_, { method: 'OPTIONS', headers: { origin: 'https://www.on2go.ca' } }));
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-origin')).toBe('https://www.on2go.ca');
    const other = await OPTIONS(new Request(URL_, { method: 'OPTIONS', headers: { origin: 'https://evil.example' } }));
    expect(other.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('honeypot: silent 202 and nothing stored; invalid: 400 with field errors; wrong content type: 415; bad JSON: 400', async () => {
    const { POST } = await import('../app/api/public/restaurant-leads/route');
    const bot = await POST(post({ ...valid(), company: 'SEO Agency' }));
    expect(bot.status).toBe(202);
    expect(await bot.json()).toEqual({ ok: true });
    expect(await listLeads()).toHaveLength(0);

    const bad = await POST(post({ ...valid(), email: 'nope' }));
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ ok: false, errors: { email: 'invalid' } });

    expect((await POST(post(valid(), { 'content-type': 'text/plain' }))).status).toBe(415);
    expect((await POST(post('{not json'))).status).toBe(400);
    expect((await POST(post('x'.repeat(20_000)))).status).toBe(413);
    expect(await listLeads()).toHaveLength(0);
  });

  it('429 after the quota, per client IP behind a trusted proxy', async () => {
    process.env.FOODHUB_TRUST_PROXY = 'true';
    const { POST } = await import('../app/api/public/restaurant-leads/route');
    for (let i = 0; i < LEAD_RATE_MAX; i++) expect((await POST(post(valid(), {}, '9.9.9.9'))).status).toBe(202);
    const blocked = await POST(post(valid(), {}, '9.9.9.9'));
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('retry-after')).toBe('600');
    expect(blocked.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    expect((await POST(post(valid(), {}, '8.8.8.8'))).status).toBe(202);
    expect(await listLeads()).toHaveLength(LEAD_RATE_MAX + 1);
  });
});

describe('emails', () => {
  it('without a provider both emails are skipped (never an error); the texts name the restaurant and never another platform', async () => {
    process.env.FOODHUB_SUPPORT_EMAIL = 'support@example.com';
    const p = parseLead(valid());
    if (p.kind !== 'ok') throw new Error('fixture');
    const lead = await saveLead(p.lead);
    const r = await notifyLead(lead);
    expect(r.support?.skipped).toBe(true);
    expect(r.reply.skipped).toBe(true);
    const n = leadNotificationText(lead);
    expect(n.subject).toContain('Chez Mimi');
    expect(n.text).toContain('Uber Eats');
    expect(n.text).toContain('mimi@example.com');
    const fr = leadAutoReplyText(lead);
    expect(fr.subject).toContain('Chez Mimi');
    expect(fr.text).toContain('Bonjour Mimi Tremblay');
    const en = leadAutoReplyText({ ...lead, lang: 'en' });
    expect(en.text).toContain('Hello Mimi Tremblay');
    for (const s of [fr.text, en.text]) expect(s).not.toMatch(/uber|doordash|skip|too good/i);
    delete process.env.FOODHUB_SUPPORT_EMAIL;
    expect((await notifyLead(lead)).support).toBeNull();
  });
});

describe('listing and follow-up', () => {
  it('status moves new → contacted → won, notes are kept with the author, unknown ids answer null', async () => {
    const p = parseLead(valid());
    if (p.kind !== 'ok') throw new Error('fixture');
    const a = await saveLead(p.lead, '2026-10-20T10:00:00.000Z');
    const b = await saveLead({ ...p.lead, restaurant: 'Plus récent' }, '2026-10-21T10:00:00.000Z');
    expect((await listLeads()).map((l) => l.id)).toEqual([b.id, a.id]);
    const moved = await updateLead(a.id, { status: 'contacted', notes: 'Appel lundi' }, 'owner');
    expect(moved).toMatchObject({ status: 'contacted', notes: 'Appel lundi', updatedBy: 'owner' });
    const won = await updateLead(a.id, { status: 'won' }, 'owner');
    expect(won).toMatchObject({ status: 'won', notes: 'Appel lundi' });
    expect(await updateLead('missing', { status: 'lost' })).toBeNull();
    expect((await listLeads()).find((l) => l.id === a.id)?.status).toBe('won');
  });

  it('the console route is owner only: no sign-in → 401, the owner (Basic) → the list', async () => {
    process.env.DASHBOARD_PASSWORD = 'Owner-pass-123';
    process.env.SESSION_SECRET = 's'.repeat(32);
    const { GET } = await import('../app/api/foodhub/restaurant-leads/route');
    const anon = await GET(new Request('http://hub.local/api/foodhub/restaurant-leads'), {} as never);
    expect(anon.status).toBe(401);
    const owner = await GET(new Request('http://hub.local/api/foodhub/restaurant-leads', { headers: { authorization: `Basic ${Buffer.from('owner:Owner-pass-123').toString('base64')}` } }), {} as never);
    expect(owner.status).toBe(200);
    expect(await owner.json()).toMatchObject({ ok: true, leads: [], statuses: ['new', 'contacted', 'won', 'lost'] });
  });
});
