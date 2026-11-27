import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as assign } from '../app/api/foodhub/clover-labels/route';
import { cloverLabelReport } from '../lib/foodhub/pos/clover-labels';

const mid = 'TESTREGISTER';
const printedTag = { id: 'kitchen', name: 'Kitchen', printers: { elements: [{ id: 'printer' }] } };
const item = (id: string, printed = false) => ({ id, name: id, tags: { elements: printed ? [{ id: printedTag.id }] : [] } });
type Page = (resource: string, offset: number, limit: number) => unknown;

function mockClover(page: Page) {
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const path = new URL(url);
    if (init?.method === 'POST') return Response.json({});
    const body = page(path.pathname.split('/').pop()!, Number(path.searchParams.get('offset')), Number(path.searchParams.get('limit')));
    return body instanceof Response ? body : Response.json(body);
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

beforeEach(() => {
  vi.stubEnv('CLOVER_MERCHANT_ID', mid);
  vi.stubEnv('CLOVER_ACCESS_TOKEN', 'test-only');
  vi.stubEnv('CLOVER_MERCHANT_TOKENS', '{}');
  vi.stubEnv('FOODHUB_FORCE_MEMORY', 'true');
  vi.stubEnv('DASHBOARD_PASSWORD', 'Test-print-only');
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('complete Clover kitchen print coverage', () => {
  it('finds a kitchen printer label on a later page and keeps already printable items out of the assignment list', async () => {
    const tags = [...Array.from({ length: 1200 }, (_, i) => ({ id: 't' + i })), printedTag];
    const items = [...Array.from({ length: 1010 }, (_, i) => item('i' + i, true)), item('uncovered')];
    mockClover((resource, offset, limit) => ({ elements: (resource === 'tags' ? tags : items).slice(offset, offset + limit) }));
    const report = await cloverLabelReport(mid);
    expect(report.ok).toBe(true);
    expect(report.kitchenLabels).toEqual([{ id: 'kitchen', name: 'Kitchen', printers: 1 }]);
    expect(report.items).toBe(1011);
    expect(report.unprinted).toEqual([{ id: 'uncovered', name: 'uncovered' }]);
  });

  it('reads items beyond the old ceiling', async () => {
    mockClover((resource, offset, limit) => ({ elements: resource === 'tags' ? [printedTag] :
      Array.from({ length: Math.min(limit, Math.max(0, 20001 - offset)) }, (_, i) => item('i' + (offset + i), offset + i < 20000)) }));
    expect(await cloverLabelReport(mid)).toMatchObject({ ok: true, items: 20001, unprinted: [{ id: 'i20000' }] });
  });

  it.each(['failed', 'malformed', 'repeated'])('refuses an assignment when a later tag page is %s', async (failure) => {
    const fetch = mockClover((resource, offset, limit) => {
      if (resource !== 'tags') return { elements: [item('uncovered')] };
      const fullPage = { elements: [printedTag, ...Array.from({ length: limit - 1 }, (_, i) => ({ id: 't' + i }))] };
      if (offset === 0 || failure === 'repeated') return fullPage;
      if (failure === 'failed') return new Response(null, { status: 503 });
      return {};
    });
    const request = new Request('http://hub.local/api/foodhub/clover-labels', { method: 'POST',
      headers: { authorization: 'Basic ' + Buffer.from('owner:Test-print-only').toString('base64'), 'content-type': 'application/json' },
      body: JSON.stringify({ merchantId: mid, tagId: printedTag.id, all: true }),
    });
    const response = await assign(request, { params: Promise.resolve({}) });
    expect(response.status).toBe(502);
    expect(fetch.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  });
});
