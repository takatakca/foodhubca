// Reviews hub API (app/api/foodhub/reviews/**): sign-in, permissions, kitchen scope. Memory database; fetch is stubbed
// to fail so no call can leave the test (DoorDash, Anthropic).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hashPassword } from '../lib/foodhub/auth';
import { getRepo } from '../lib/foodhub/repo';
import { getReview, makeReview, upsertReviews, type ReviewInput } from '../lib/foodhub/reviews/model';
import type { Role } from '../lib/foodhub/types';

const ENV = ['FOODHUB_FORCE_MEMORY', 'DASHBOARD_PASSWORD', 'ANTHROPIC_API_KEY', 'DOORDASH_DEVELOPER_ID', 'DOORDASH_KEY_ID', 'DOORDASH_SIGNING_SECRET', 'DOORDASH_REPORTS_DEVELOPER_ID', 'DOORDASH_REPORTS_KEY_ID', 'DOORDASH_REPORTS_SIGNING_SECRET', 'DOORDASH_ENV'];
const saved: Record<string, string | undefined> = {};
const BASE = 'http://foodhub.test';
const PASS = 'review-pass-123';
const auth = (u: string) => ({ authorization: `Basic ${Buffer.from(`${u}:${PASS}`).toString('base64')}` });
let n = 0;
const rv = (over: Partial<ReviewInput>) => makeReview({ platform: 'doordash', storeRef: 's', orderRef: `o-${n++}`, at: new Date(Date.now() - 86_400_000).toISOString(), stars: 2, text: 'Froid', source: 'import', importId: 'i', ...over });

async function user(username: string, role: Role, locations: string[] = []) {
  await getRepo().saveUser({ username, name: username, role, locations, passwordHash: hashPassword(PASS), active: true });
}

beforeEach(async () => {
  for (const k of ENV) { saved[k] = process.env[k]; delete process.env[k]; }
  process.env.FOODHUB_FORCE_MEMORY = 'true';
  (globalThis as { __foodhubMem?: unknown }).__foodhubMem = undefined;
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('no live calls in tests'); }));
  await user('boss', 'manager');
  await user('hoch', 'manager', ['HOCHELAGA']);
  await user('viewer', 'analyst', ['HOCHELAGA']);
  await user('menu', 'menu');
});
afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

const list = async () => (await import('../app/api/foodhub/reviews/route')).GET;
const one = async () => (await import('../app/api/foodhub/reviews/[id]/route')).POST;
const imp = async () => (await import('../app/api/foodhub/reviews/import/route')).POST;
const dd = async () => (await import('../app/api/foodhub/reviews/doordash/route'));
const batch = async () => (await import('../app/api/foodhub/reviews/drafts/route')).POST;
const post = (path: string, who: string, body: unknown) => new Request(`${BASE}${path}`, { method: 'POST', headers: { ...auth(who), 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('GET /api/foodhub/reviews', () => {
  it('needs a sign-in and analytics:view', async () => {
    const GET = await list();
    expect((await GET(new Request(`${BASE}/api/foodhub/reviews`), {})).status).toBe(401);
    expect((await GET(new Request(`${BASE}/api/foodhub/reviews`, { headers: auth('menu') }), {})).status).toBe(403);
  });

  it('a person limited to one kitchen sees only that kitchen; filters apply', async () => {
    await upsertReviews([
      rv({ brandName: 'Pi Pita', locationCode: 'HOCHELAGA', stars: 1 }),
      rv({ brandName: 'Pi Pita', locationCode: 'HOCHELAGA', stars: 5, text: 'Rapide', platform: 'uber_eats' }),
      rv({ brandName: 'OOeuf', locationCode: 'NDG_MAIN', stars: 2 }),
      rv({ brandName: null, locationCode: null, stars: 3 }),
    ]);
    const GET = await list();
    const mine = await (await GET(new Request(`${BASE}/api/foodhub/reviews`, { headers: auth('viewer') }), {})).json();
    expect(mine.total).toBe(2);
    expect(mine.reviews.every((r: { locationCode: string }) => r.locationCode === 'HOCHELAGA')).toBe(true);
    expect(mine.summary.overall).toMatchObject({ count: 2, avg: 3 });
    expect(mine.reviews.find((r: { platform: string }) => r.platform === 'doordash').daysLeft).toBe(6);
    const all = await (await GET(new Request(`${BASE}/api/foodhub/reviews`, { headers: auth('boss') }), {})).json();
    expect(all.total).toBe(4);
    const filtered = await (await GET(new Request(`${BASE}/api/foodhub/reviews?platform=doordash&stars=1,2&theme=cold`, { headers: auth('boss') }), {})).json();
    expect(filtered.total).toBe(2);
    const asking = await (await GET(new Request(`${BASE}/api/foodhub/reviews?kitchen=NDG_MAIN`, { headers: auth('viewer') }), {})).json();
    expect(asking.total).toBe(0); // another kitchen asked by name is still out of scope
    const unanswered = await (await GET(new Request(`${BASE}/api/foodhub/reviews?unanswered=1&brand=OOeuf`, { headers: auth('boss') }), {})).json();
    expect(unanswered.total).toBe(1);
  });
});

describe('POST /api/foodhub/reviews/[id]', () => {
  it('needs menu:edit and the review in the person’s kitchens', async () => {
    const hoch = rv({ brandName: 'Pi Pita', locationCode: 'HOCHELAGA' });
    const ndg = rv({ brandName: 'OOeuf', locationCode: 'NDG_MAIN' });
    await upsertReviews([hoch, ndg]);
    const POST = await one();
    const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
    expect((await POST(post(`/api/foodhub/reviews/${hoch.id}`, 'viewer', { action: 'draft' }), ctx(hoch.id))).status).toBe(403);
    expect((await POST(post(`/api/foodhub/reviews/${ndg.id}`, 'hoch', { action: 'draft' }), ctx(ndg.id))).status).toBe(404);
    const drafted = await (await POST(post(`/api/foodhub/reviews/${hoch.id}`, 'hoch', { action: 'draft' }), ctx(hoch.id))).json();
    expect(drafted).toMatchObject({ ok: true, source: 'template' });
    expect(drafted.review.reply.draft).toMatch(/Pi Pita/);
    await POST(post(`/api/foodhub/reviews/${hoch.id}`, 'hoch', { action: 'replied' }), ctx(hoch.id));
    expect((await getReview(hoch.id))?.reply?.repliedBy).toBe('hoch');
    expect((await POST(post(`/api/foodhub/reviews/${hoch.id}`, 'hoch', { action: 'post' }), ctx(hoch.id))).status).toBe(400); // no posting action exists
  });
});

describe('POST /api/foodhub/reviews/import', () => {
  it('multipart upload: preview with ?dryRun=1, then saved; kitchen outside the scope refused', async () => {
    const POST = await imp();
    const file = () => { const f = new FormData(); f.set('file', new Blob(['Store,Rating,Comment,Date\nPi Pita Hochelaga,4,Bon,2026-10-01\n'], { type: 'text/csv' }), 'uber.csv'); return f; };
    expect((await POST(new Request(`${BASE}/api/foodhub/reviews/import`, { method: 'POST', headers: auth('viewer'), body: file() }), {})).status).toBe(403);
    const dry = await (await POST(new Request(`${BASE}/api/foodhub/reviews/import?dryRun=1`, { method: 'POST', headers: auth('boss'), body: file() }), {})).json();
    expect(dry).toMatchObject({ ok: true, imported: false, dryRun: true, platform: 'uber_eats', counts: { new: 1 } });
    expect(await getRepo().listDocs('reviews')).toHaveLength(0);
    const done = await (await POST(new Request(`${BASE}/api/foodhub/reviews/import`, { method: 'POST', headers: auth('boss'), body: file() }), {})).json();
    expect(done).toMatchObject({ ok: true, imported: true, counts: { new: 1 } });
    const scoped = file(); scoped.set('locationCode', 'NDG_MAIN');
    expect((await POST(new Request(`${BASE}/api/foodhub/reviews/import`, { method: 'POST', headers: auth('hoch'), body: scoped }), {})).status).toBe(403);
    const ask = new FormData(); ask.set('file', new Blob(['A,B,C\n1,2,3\n']), 'x.csv');
    expect(await (await POST(new Request(`${BASE}/api/foodhub/reviews/import`, { method: 'POST', headers: auth('boss'), body: ask }), {})).json()).toMatchObject({ ok: true, needsMapping: true, imported: false });
  });
});

describe('DoorDash and batch routes', () => {
  it('DoorDash: all-kitchens people only; missing credentials are a clean refusal, nothing sent', async () => {
    const { GET, POST } = await dd();
    expect((await POST(post('/api/foodhub/reviews/doordash', 'hoch', { action: 'request', from: '2026-10-01', to: '2026-10-15' }), {})).status).toBe(403);
    const res = await POST(post('/api/foodhub/reviews/doordash', 'boss', { action: 'request', from: '2026-10-01', to: '2026-10-15' }), {});
    expect(res.status).toBe(409);
    const refusal = await res.json();
    expect(refusal.error).toMatch(/credentials missing/);
    expect(refusal.errorFr).toMatch(/^Identifiants de l’API de rapports DoorDash manquants : DOORDASH_REPORTS_DEVELOPER_ID/);
    expect(fetch).not.toHaveBeenCalled();
    expect(await (await GET(new Request(`${BASE}/api/foodhub/reviews/doordash`, { headers: auth('boss') }), {})).json()).toMatchObject({ ok: true, reports: [] });
    expect((await POST(post('/api/foodhub/reviews/doordash', 'boss', { action: 'nope' }), {})).status).toBe(400);
  });

  it('batch drafts: only the person’s unanswered reviews without a draft', async () => {
    await upsertReviews([rv({ brandName: 'Pi Pita', locationCode: 'HOCHELAGA' }), rv({ brandName: 'Pi Pita', locationCode: 'HOCHELAGA', text: '' }), rv({ brandName: 'OOeuf', locationCode: 'NDG_MAIN' })]);
    const POST = await batch();
    const out = await (await POST(post('/api/foodhub/reviews/drafts', 'hoch', {}), {})).json();
    expect(out).toMatchObject({ ok: true, drafted: 1, templates: 1, remaining: 0 });
    expect((await POST(post('/api/foodhub/reviews/drafts', 'viewer', {}), {})).status).toBe(403);
  });
});

describe('review fixes: edited drafts, DoorDash list scope, early size refusal', () => {
  it('save: the edited draft is stored when it passes the guard, refused (422, French reasons) when it does not', async () => {
    const r = rv({ brandName: 'Pi Pita', locationCode: 'HOCHELAGA' });
    await upsertReviews([r]);
    const POST = await one();
    const ctx = { params: Promise.resolve({ id: r.id }) };
    const saved = await (await POST(post(`/api/foodhub/reviews/${r.id}`, 'hoch', { action: 'save', draft: 'Bonjour, désolés pour le repas froid. L’équipe Pi Pita' }), ctx)).json();
    expect(saved).toMatchObject({ ok: true, review: { reply: { draft: 'Bonjour, désolés pour le repas froid. L’équipe Pi Pita', draftSource: 'edited', draftBy: 'hoch' } } });
    const bad = await POST(post(`/api/foodhub/reviews/${r.id}`, 'hoch', { action: 'save', draft: 'Votre prochaine commande est sur nous: www.pipita.ca' }), ctx);
    expect(bad.status).toBe(422);
    expect(await bad.json()).toMatchObject({ ok: false, errorFr: expect.stringMatching(/^Brouillon non enregistré/), reasonsFr: expect.arrayContaining(['lien ou adresse web']) });
    expect((await getReview(r.id))?.reply?.draft).toBe('Bonjour, désolés pour le repas froid. L’équipe Pi Pita');
    expect((await POST(post(`/api/foodhub/reviews/${r.id}`, 'hoch', { action: 'save' }), ctx)).status).toBe(400);
    expect((await POST(post(`/api/foodhub/reviews/${r.id}`, 'viewer', { action: 'save', draft: 'Bonjour' }), ctx)).status).toBe(403);
    expect(await (await POST(post('/api/foodhub/reviews/nope', 'hoch', { action: 'save', draft: 'Bonjour' }), { params: Promise.resolve({ id: 'nope' }) })).json()).toMatchObject({ errorFr: 'Avis introuvable' });
  });

  it('DoorDash report list: refused to a person limited to some kitchens', async () => {
    const { GET } = await dd();
    const res = await GET(new Request(`${BASE}/api/foodhub/reviews/doordash`, { headers: auth('hoch') }), {});
    expect(res.status).toBe(403);
    expect((await res.json()).errorFr).toMatch(/toutes les cuisines/);
  });

  it('import: a body announced over the limit, or base64 over the limit, is refused before it is read', async () => {
    const POST = await imp();
    const big = new Request(`${BASE}/api/foodhub/reviews/import`, { method: 'POST', headers: { ...auth('boss'), 'content-type': 'application/json', 'content-length': String(50 * 1024 * 1024) }, body: '{}' });
    const res = await POST(big, {});
    expect(res.status).toBe(413);
    expect((await res.json()).errorFr).toMatch(/max 5 Mo/);
    const b64 = await POST(post('/api/foodhub/reviews/import', 'boss', { fileName: 'x.csv', contentBase64: 'A'.repeat(7 * 1024 * 1024 + 8) }), {});
    expect(b64.status).toBe(413);
  });
});
