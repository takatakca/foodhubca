// Opt-in, against a REAL Takatak MEV (QCMEV) in SIMULATOR mode — never PROD: a TAKATAK MEV App Market merchant whose
// kitchen code was linked in the QCMEV dashboard (QCMEV.CA tools/demo-video/check-signup.mjs prints it) is turned on by
// Food Hub's real /health read, then its Clover register sale and its refund go through the real outbox to QCMEV.
// Skipped unless all three are set:
//   FOODHUB_LIVE_QCMEV_URL       e.g. http://127.0.0.1:3101 (QCMEV with QCMEV_FOODHUB_ENABLED=true)
//   FOODHUB_LIVE_QCMEV_SECRET    QCMEV's QCMEV_FOODHUB_SECRET
//   FOODHUB_LIVE_QCMEV_LOCATION  the CLV_… code linked in QCMEV (tenant "takatak")
// Memory repository, placeholder data only.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkMevMerchant, type MevMerchant } from '../lib/foodhub/mev/clover-merchants';
import { getRegisterSale, ingestRegisterOrder, registerSaleId } from '../lib/foodhub/mev/clover-register';
import { deviceReceipt } from '../lib/foodhub/mev/clover-device';
import { mevGate } from '../lib/foodhub/mev/config';
import { mevHealth, settleMevKicks } from '../lib/foodhub/mev/outbox';
import { getRepo } from '../lib/foodhub/repo';

const URL_ = process.env.FOODHUB_LIVE_QCMEV_URL ?? '';
const SECRET = process.env.FOODHUB_LIVE_QCMEV_SECRET ?? '';
const CODE = process.env.FOODHUB_LIVE_QCMEV_LOCATION ?? '';
const MID = 'MIDLIVEQCMEV1';

/** Poutine 11,50 $ + 2 × Boisson 2,75 $ = 17,00 $; TPS 0,85 + TVQ 1,70 = 19,55 $ by debit card. */
function order(id: string, refunded = false) {
  return {
    id, title: '', total: 1955, paymentState: refunded ? 'REFUNDED' : 'PAID', createdTime: Date.now() - 60_000,
    lineItems: { elements: [
      { id: `${id}-L1`, name: 'Poutine régulière', price: 1150, item: { id: 'ITEM-POUTINE' } },
      { id: `${id}-L2`, name: 'Boisson gazeuse', price: 275, unitQty: 2000, item: { id: 'ITEM-POP' } },
    ] },
    payments: { elements: [{ id: `${id}-P1`, amount: 1955, taxAmount: 255, tipAmount: 0, result: 'SUCCESS', createdTime: Date.now() - 30_000, tender: { label: 'Debit Card' } }] },
    refunds: { elements: refunded ? [{ id: `${id}-R1`, amount: 1955, taxAmount: 255, tipAmount: 0 }] : [] },
  };
}

describe.skipIf(!URL_ || !SECRET || !CODE)('live: App Market merchant → real Takatak MEV (SIMULATOR)', () => {
  const saved: Record<string, string | undefined> = {};
  const env: Record<string, string> = {
    FOODHUB_FORCE_MEMORY: 'true', FOODHUB_RETRY_TIMER: 'off', FOODHUB_MEV: 'simulator', FOODHUB_FEATURE_MEV: 'on',
    FOODHUB_MEV_URL: URL_, FOODHUB_MEV_SECRET: SECRET, FOODHUB_MEV_CLOVER_REGISTER: 'on', FOODHUB_MEV_LOCATIONS: '',
  };
  beforeAll(async () => {
    for (const [k, v] of Object.entries(env)) { saved[k] = process.env[k]; process.env[k] = v; }
    (globalThis as any).__foodhubMem = undefined;
    (globalThis as any).__mevHealth = undefined;
    // The enrollment the welcome page would have made for this merchant, with the code linked in QCMEV.
    const m: MevMerchant = { merchantId: MID, locationCode: CODE, status: 'waiting', createdAt: new Date().toISOString() };
    await getRepo().setKv(`mev_merchant:${MID}`, m);
    await getRepo().setKv(`mev_merchant_code:${CODE}`, MID);
  });
  afterAll(() => { for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v; });

  it('QCMEV is a test server (never PROD) and reports the code ready → Food Hub turns the merchant on', async () => {
    const h = await mevHealth({ force: true });
    expect(h.error).toBeUndefined();
    expect(String(h.health?.environment)).not.toBe('PROD');
    const r = await checkMevMerchant(MID, { maxAgeMs: 0 });
    expect(r.merchant).toMatchObject({ status: 'active', ready: { linked: true, deviceReady: true, certReady: true, usersReady: true } });
    expect(await mevGate(CODE)).toMatchObject({ active: true, mode: 'simulator' });
  });

  it('its register sale is numbered by QCMEV; the device app gets the invoice text and QR; the refund is a credit note', async () => {
    const oid = `LIVE${Date.now().toString(36).toUpperCase()}`;
    expect((await ingestRegisterOrder(MID, order(oid)))?.locationCode).toBe(CODE);
    await settleMevKicks();
    const sale = await getRegisterSale(registerSaleId(MID, oid));
    expect(sale?.mev).toMatchObject({ status: 'accepted' });
    expect(sale?.mev?.noTrans).toBeTruthy();
    const receipt = deviceReceipt(sale);
    expect(receipt.text80mm?.length).toBeGreaterThan(5);
    expect(receipt.text80mm?.join('\n')).toContain('[CODE QR]');
    expect(receipt.qrUrl ?? receipt.qrImage).toBeTruthy();

    await ingestRegisterOrder(MID, order(oid, true));
    await settleMevKicks();
    const after = await getRegisterSale(registerSaleId(MID, oid));
    expect(after?.mev?.status).toBe('credited');
    expect(after?.mev?.creditNotes?.length).toBe(1);
  });
});
