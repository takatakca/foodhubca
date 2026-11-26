import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET, POST } from '@/app/api/foodhub/catalog/route';
import { getRepo } from '@/lib/foodhub/repo';

const ROUTE = 'https://foodhub.example.test/api/foodhub/catalog';
const OWNER_PASSWORD = 'catalog-phone-fixture-password';
const LOCATION = { code: 'TEST_PHONE', name: 'Phone fixture kitchen', address: '123 Test Street', active: true };
const FORMATTED_PHONE = '(514) 555-0124';
const SAVED_PHONE = '+15145550124';

function request(method: 'GET' | 'POST', location?: typeof LOCATION & { phone?: string | null }) {
  return new Request(ROUTE, {
    method,
    headers: { authorization: `Basic ${Buffer.from(`owner:${OWNER_PASSWORD}`).toString('base64')}`, 'content-type': 'application/json' },
    body: location ? JSON.stringify({ location }) : undefined,
  });
}

async function savedLocation() {
  const response = await GET(request('GET'), undefined);
  expect(response.status).toBe(200);
  const payload = await response.json() as { locations: Array<typeof LOCATION & { phone?: string | null }> };
  return payload.locations.find(({ code }) => code === LOCATION.code);
}

beforeEach(() => {
  vi.stubEnv('FOODHUB_FORCE_MEMORY', 'true');
  vi.stubEnv('DASHBOARD_PASSWORD', OWNER_PASSWORD);
  vi.stubGlobal('__foodhubMem', undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('Kitchen fallback phone in the authenticated catalog', () => {
  it('refuses an invalid nonblank number before changing the configured phone or address', async () => {
    expect((await POST(request('POST', { ...LOCATION, phone: FORMATTED_PHONE }), undefined)).status).toBe(200);
    expect(await savedLocation()).toMatchObject({ phone: SAVED_PHONE });

    const response = await POST(request('POST', { ...LOCATION, address: 'Different address', phone: '514 555 01' }), undefined);
    const payload = await response.json();
    const saved = await savedLocation();
    expect({ status: response.status, ok: payload.ok, phone: saved?.phone, address: saved?.address })
      .toEqual({ status: 400, ok: false, phone: SAVED_PHONE, address: LOCATION.address });
    expect(payload.error).toMatch(/kitchen phone/i);
  });

  it.each(['', '   ', null])('keeps intentional clear behavior for %j', async (blank) => {
    expect((await POST(request('POST', { ...LOCATION, phone: FORMATTED_PHONE }), undefined)).status).toBe(200);
    expect((await POST(request('POST', { ...LOCATION, phone: blank }), undefined)).status).toBe(200);
    expect(await savedLocation()).toMatchObject({ phone: null });
  });

  it.each([SAVED_PHONE, 'legacy extension entry'])('keeps the stored number when an address edit leaves it out (%s)', async (phone) => {
    await getRepo().setKv('catalog', { locations: [{ ...LOCATION, phone }] });
    const update = { ...LOCATION, address: 'New Test Street' };
    expect((await POST(request('POST', update), undefined)).status).toBe(200);
    expect(await savedLocation()).toMatchObject({ address: update.address, phone });
  });
});
