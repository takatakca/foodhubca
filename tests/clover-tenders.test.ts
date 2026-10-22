// Platform tenders in Clover ("Uber Eats", "DoorDash"…): found by label (any case) or created once. Clover may refuse
// our labelKey (hand-made tenders have none; the live register refused it on 2026-10-16): the same tender is then
// created without it, and when Clover still says no, its own answer is shown — never a guessed permission message.
// Every Clover answer here is mocked: no live Clover call.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cloverOrderTypeFor, cloverTenderFor, recordCloverPayment } from '../lib/foodhub/pos/clover-books';
import { sendCloverTestOrder, testOrder } from '../lib/foodhub/pos/clover-test-order';

const MID = 'TESTMERCH0002'; // a made-up merchant ID (the repository is public: never a real one)
const realFetch = globalThis.fetch;
type Call = { method: string; path: string; body: any };
type Answer = { status: number; json: unknown };
let calls: Call[] = [];
let tenders: Array<{ id: string; label: string; labelKey?: string }> = [];
let tenderSeq = 0;
/** What the mocked Clover answers to POST /tenders. Default: refuses any labelKey, accepts the same tender without it. */
let onTenderPost: (body: any) => Answer;

const refuseLabelKey = (body: any): Answer => {
  if (body?.labelKey) return { status: 400, json: { message: 'Invalid labelKey (mocked Clover answer)' } };
  const t = { id: `T-${++tenderSeq}`, label: body?.label };
  tenders.push(t);
  return { status: 200, json: t };
};

function mockClover() {
  globalThis.fetch = vi.fn(async (input: any, init: any = {}) => {
    const url = new URL(String(input));
    const p = url.pathname;
    const method = String(init.method || 'GET').toUpperCase();
    const body = init.body ? JSON.parse(String(init.body)) : null;
    calls.push({ method, path: p, body });
    const json = (status: number, j: unknown) => new Response(JSON.stringify(j), { status, headers: { 'Content-Type': 'application/json' } });
    const m = `/v3/merchants/${MID}`;
    if (p === `${m}/tenders`) {
      if (method === 'GET') return json(200, { elements: tenders });
      const a = onTenderPost(body);
      return json(a.status, a.json);
    }
    if (p === `${m}/order_types`) return method === 'POST' ? json(200, { id: 'OT-UBER', label: body?.label }) : json(200, { elements: [] });
    if (p === `${m}/atomic_order/orders`) return json(200, { id: 'CLV1' });
    if (p === `${m}/print_event`) return json(200, { id: 'PE-1', state: 'CREATED' });
    if (p === `${m}/orders/CLV1/payments`) return json(200, { id: 'PAY-1' });
    if (p === `${m}/orders/CLV1`) return json(200, { id: 'CLV1', total: 2242 });
    return json(404, {});
  }) as any;
}

const tenderPosts = () => calls.filter((c) => c.method === 'POST' && c.path.endsWith('/tenders'));

beforeEach(() => {
  process.env.FOODHUB_FORCE_MEMORY = 'true';
  (globalThis as any).__foodhubMem = undefined;
  process.env.CLOVER_BASE_URL = 'https://api.clover.com';
  process.env.CLOVER_MERCHANT_ID = MID;
  process.env.CLOVER_ACCESS_TOKEN = 'ENV-TOKEN';
  delete process.env.CLOVER_MERCHANT_TOKENS; delete process.env.FOODHUB_CLOVER_RECORD_PAYMENT; delete process.env.FOODHUB_CLOVER_ORDER_TYPES;
  delete process.env.ALERT_WEBHOOK_URL;
  calls = []; tenders = [{ id: 'T-CASH', label: 'Cash', labelKey: 'com.clover.tender.cash' }]; tenderSeq = 0;
  onTenderPost = refuseLabelKey;
  mockClover();
});
afterEach(() => { globalThis.fetch = realFetch; });

describe('Clover platform tenders', () => {
  it('retries without labelKey when Clover refuses it, then reuses the new tender', async () => {
    expect(await cloverTenderFor(MID, 'uber_eats')).toEqual({ id: 'T-1' });
    const posts = tenderPosts();
    expect(posts).toHaveLength(2);
    expect(posts[0].body).toMatchObject({ label: 'Uber Eats', labelKey: 'com.takatak.foodhub.uber_eats' });
    expect(posts[1].body).toEqual({ label: 'Uber Eats', enabled: true, visible: true, opensCashDrawer: false });
    calls = [];
    expect(await cloverTenderFor(MID, 'uber_eats')).toEqual({ id: 'T-1' }); // remembered: no new call to Clover
    expect(calls).toHaveLength(0);
  });

  it('creates it in one call when Clover accepts the labelKey', async () => {
    onTenderPost = (body) => ({ status: 200, json: { id: 'T-KEYED', label: body.label, labelKey: body.labelKey } });
    expect(await cloverTenderFor(MID, 'skip')).toEqual({ id: 'T-KEYED' });
    expect(tenderPosts()).toHaveLength(1);
  });

  it('reuses a tender made by hand whatever its case ("DOORDASH"), without creating one', async () => {
    tenders.push({ id: 'T-HAND', label: ' DOORDASH ', labelKey: '' });
    expect(await cloverTenderFor(MID, 'doordash')).toEqual({ id: 'T-HAND' });
    expect(tenderPosts()).toHaveLength(0);
  });

  it('shows Clover’s own answers when both bodies are refused', async () => {
    onTenderPost = (body) => body.labelKey
      ? { status: 400, json: { message: 'Invalid labelKey (mocked)' } }
      : { status: 403, json: { message: 'Forbidden: MERCHANT_W (mocked)' } };
    const r = await cloverTenderFor(MID, 'uber_eats');
    expect(r.id).toBeNull();
    expect(r.error).toContain('HTTP 400');
    expect(r.error).toContain('Invalid labelKey (mocked)');
    expect(r.error).toContain('HTTP 403');
    expect(r.error).toContain('Forbidden: MERCHANT_W (mocked)');
    expect(r.error).not.toMatch(/Payments write/);
  });

  it('never posts a twin when Clover says 200 without an id', async () => {
    onTenderPost = () => ({ status: 200, json: {} });
    const r = await cloverTenderFor(MID, 'tgtg');
    expect(r.id).toBeNull();
    expect(r.error).toContain('HTTP 200');
    expect(tenderPosts()).toHaveLength(1);
  });

  it('says there is no token instead of calling Clover twice', async () => {
    delete process.env.CLOVER_ACCESS_TOKEN;
    const r = await cloverTenderFor(MID, 'uber_eats');
    expect(r).toEqual({ id: null, error: `No Clover API token for merchant ${MID}` });
    expect(calls).toHaveLength(0);
  });

  it('order types still post one body with no labelKey', async () => {
    expect(await cloverOrderTypeFor(MID, 'uber_eats')).toBe('OT-UBER');
    expect(calls.filter((c) => c.method === 'POST' && c.path.endsWith('/order_types')).map((c) => c.body)).toEqual([{ label: 'Uber Eats', taxable: true }]);
  });
});

describe('recording the platform payment', () => {
  const order = () => ({ ...testOrder(), posOrderId: 'CLV1' });

  it('pays with the tender created without labelKey', async () => {
    const r = await recordCloverPayment(order(), MID);
    expect(r).toMatchObject({ ok: true, paymentId: 'PAY-1' });
    expect(calls.find((c) => c.path.endsWith('/payments'))?.body.tender).toEqual({ id: 'T-1' });
  });

  it('logs Clover’s answer on the order when the tender cannot be made', async () => {
    onTenderPost = () => ({ status: 403, json: { message: 'Forbidden (mocked)' } });
    const r = await recordCloverPayment(order(), MID);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/^Could not find or create the "Uber Eats" tender in Clover: HTTP 403 .*Forbidden \(mocked\)/);
    expect(calls.some((c) => c.path.endsWith('/payments'))).toBe(false);
  });
});

describe('owner test order (Settings → Clover app)', () => {
  it('goes through to PAID when Clover refuses the labelKey', async () => {
    const r = await sendCloverTestOrder(MID, Date.now(), { tokenMerchant: true, actor: 'Owner' });
    expect(r.ok && r.steps.map((s) => [s.key, s.ok])).toEqual([['created', true], ['printed', true], ['paid', true]]);
    expect(calls.find((c) => c.path.endsWith('/payments'))?.body).toMatchObject({ amount: 2242, tender: { id: 'T-1' } });
  });

  it('shows Clover’s answer on the paid step, in French and English', async () => {
    onTenderPost = () => ({ status: 401, json: { message: 'Unauthorized (mocked)' } });
    const r = await sendCloverTestOrder(MID, Date.now(), { tokenMerchant: true, actor: 'Owner' });
    const paid = r.steps.find((s) => s.key === 'paid')!;
    expect(paid.ok).toBe(false);
    expect(paid.detail.fr).toMatch(/^Le mode de paiement « Uber Eats » n’a pas pu être trouvé ni créé dans Clover : HTTP 401 .*Unauthorized \(mocked\)/);
    expect(paid.detail.en).toMatch(/^The “Uber Eats” tender could not be found or created in Clover: HTTP 401 .*Unauthorized \(mocked\)/);
    expect(paid.detail.en).not.toMatch(/Payments write/);
  });
});
