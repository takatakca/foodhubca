// A store mapped to the payment processor's all-digits merchant number (printed on card statements and the terminal)
// instead of the Clover merchant ID never gets its orders into the register: Clover's API does not know that number.
// Production had 7 Uber stores on such a number, copied from store to store by the merchant picker. Refused on save,
// and never offered again.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { POST } from '../app/api/foodhub/stores/route';
import { cloverMerchantIdProblem, knownCloverMerchants } from '../lib/foodhub/pos/clover';
import { getRepo } from '../lib/foodhub/repo';

const saved: Record<string, string | undefined> = {};
const ENV: Record<string, string | undefined> = { FOODHUB_FORCE_MEMORY: 'true', CLOVER_MERCHANT_ID: 'TESTMERCH0001', CLOVER_MERCHANT_TOKENS: undefined, DASHBOARD_PASSWORD: 'Owner-pass-123', SESSION_SECRET: undefined };

beforeEach(() => {
  for (const [k, v] of Object.entries(ENV)) { saved[k] = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  (globalThis as any).__foodhubMem = undefined;
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

const ctx = { params: Promise.resolve({}) } as any;
const save = (body: Record<string, unknown>) => POST(new Request('http://hub.local/api/foodhub/stores', { method: 'POST', headers: { authorization: `Basic ${Buffer.from('owner:Owner-pass-123').toString('base64')}`, 'content-type': 'application/json' }, body: JSON.stringify(body) }) as any, ctx);

describe('Clover merchant ID on a store mapping', () => {
  it('tells the processor merchant number apart from a Clover merchant ID', () => {
    expect(cloverMerchantIdProblem('29759040017')?.en).toMatch(/payment processor's merchant number/);
    expect(cloverMerchantIdProblem('29759040017')?.fr).toMatch(/processeur de paiement/);
    expect(cloverMerchantIdProblem('clover.com/home/m/X')?.en).toMatch(/letters and digits only/);
    expect(cloverMerchantIdProblem('TESTMERCH0001')).toBeNull();
    expect(cloverMerchantIdProblem('')).toBeNull(); // empty = the default merchant
    expect(cloverMerchantIdProblem(undefined)).toBeNull();
  });

  it('a mapping with the processor number is refused; the Clover merchant ID or empty is saved', async () => {
    const base = { channel: 'uber_eats', channelStoreId: 'ue-test-1', brandName: 'Po Poulet', locationCode: 'NDG_6284' };
    const bad = await save({ ...base, cloverMerchantId: '29759040017' });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toMatch(/payment processor's merchant number/);
    expect(await getRepo().findStore('uber_eats', 'ue-test-1')).toBeNull();
    const good = await save({ ...base, cloverMerchantId: 'TESTMERCH0002' });
    expect(good.status).toBe(200);
    expect((await getRepo().findStore('uber_eats', 'ue-test-1'))?.cloverMerchantId).toBe('TESTMERCH0002');
  });

  it('a wrong ID already saved on a store is not offered again in the merchant pickers', () => {
    expect(knownCloverMerchants(['29759040017', 'TESTMERCH0002', null])).toEqual(['TESTMERCH0001', 'TESTMERCH0002']);
  });
});
