// The TAKATAK MEV app on the Clover device (apps/clover-mev-android) asks Food Hub for the invoice of a register sale,
// prints it on the Clover printer (text + QR code — Clover's REST API cannot print a QR), and asks for a reproduction
// (RPR) or a merchant copy (DUP). Routes: app/api/foodhub/mev/clover-device/*.
//
// Credential: the merchant's own Clover token, which the device app gets from Clover on the device (CloverAuth), sent as
// "Authorization: Bearer <token>" with "X-Clover-Merchant-Id". Food Hub checks it with Clover (GET /v3/merchants/{mId}
// must answer that merchant), keeps the answer 10 minutes (only a hash of the token), and serves only that merchant's
// register sales. The merchant must also be one Food Hub already works with: an approved TAKATAK MEV install, or a
// merchant Food Hub holds a token for.
import { cloverBaseUrl, cloverToken } from '../pos/clover';
import { cloverMevAppEnabled } from '../pos/clover-apps';
import { connectedCloverMerchantIds } from '../pos/clover-oauth';
import { cloverFetch } from '../pos/clover-http';
import { getRegisterSale, ingestRegisterOrder, isRegisterOrder, registerSaleId } from './clover-register';
import { sha256 } from './map';
import type { MevRecord, RegisterSale } from './types';

const MERCHANT_ID = /^[A-Z0-9]{8,20}$/;
const ORDER_ID = /^[A-Z0-9]{8,20}$/;
const TTL_MS = 10 * 60_000;
const verified = new Map<string, number>();

export const validOrderId = (v: unknown): v is string => typeof v === 'string' && ORDER_ID.test(v);

export type DeviceAuth = { ok: true; merchantId: string; token: string } | { ok: false; status: number; error: string };

/** The device's own Clover token, checked with Clover for that merchant. */
export async function verifyCloverDevice(req: Request, now = Date.now()): Promise<DeviceAuth> {
  const merchantId = String(req.headers.get('x-clover-merchant-id') ?? '').trim();
  const auth = String(req.headers.get('authorization') ?? '');
  const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
  if (!MERCHANT_ID.test(merchantId) || token.length < 16) return { ok: false, status: 401, error: 'Clover merchant id and token required.' };
  const key = sha256(`${merchantId}:${token}`);
  if ((verified.get(key) ?? 0) > now) return { ok: true, merchantId, token };
  const known = (await cloverToken(merchantId).catch(() => null)) !== null
    || (cloverMevAppEnabled() && (await connectedCloverMerchantIds('mev').catch(() => [] as string[])).includes(merchantId));
  if (!known) return { ok: false, status: 403, error: 'This Clover merchant is not connected to TAKATAK MEV (or is waiting for approval).' };
  try {
    const res = await cloverFetch(`${cloverBaseUrl()}/v3/merchants/${encodeURIComponent(merchantId)}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } }, { timeoutMs: 5000, retries: 0 });
    const body = await res.json().catch(() => null);
    if (!res.ok || String(body?.id ?? '') !== merchantId) return { ok: false, status: 401, error: 'Clover did not accept this token for this merchant.' };
  } catch {
    return { ok: false, status: 503, error: 'Clover could not be reached to check the token.' };
  }
  if (verified.size > 2000) for (const [k, exp] of verified) if (exp < now) verified.delete(k);
  verified.set(key, now + TTL_MS);
  return { ok: true, merchantId, token };
}

/** What the device prints and shows: the invoice exactly as Takatak MEV rendered it, never Food Hub's own numbers. */
export interface DeviceReceipt {
  status: MevRecord['status'] | 'unknown' | 'not_register';
  reason?: string;
  noTrans?: string;
  mevNumber?: string;
  text80mm?: string[];
  qrImage?: string;
  /** What the QR code encodes: the device draws the QR itself when the image is not a PNG it can print. */
  qrUrl?: string;
  /** Original printed already (then a second paper is a reproduction, RPR). */
  printedAt?: string;
  prints?: Array<{ printKey: string; mode: 'RPR' | 'DUP'; status: string; text80mm?: string[]; qrImage?: string }>;
  creditNotes?: MevRecord['creditNotes'];
}

export function deviceReceipt(r: RegisterSale | null): DeviceReceipt {
  const mev = r?.mev;
  if (!r || !mev) return { status: 'unknown' };
  return {
    status: mev.status,
    ...(mev.reason ? { reason: mev.reason } : {}),
    ...(mev.noTrans ? { noTrans: mev.noTrans } : {}),
    ...(mev.mevNumber ? { mevNumber: mev.mevNumber } : {}),
    ...(mev.text80mm?.length ? { text80mm: mev.text80mm } : {}),
    ...(mev.qrImage ? { qrImage: mev.qrImage } : {}),
    ...(mev.qrUrl ? { qrUrl: mev.qrUrl } : {}),
    ...(mev.printed?.[mev.saleKey] ? { printedAt: mev.printed[mev.saleKey] } : {}),
    ...(mev.prints?.length ? { prints: mev.prints.map((p) => ({ printKey: p.printKey, mode: p.mode, status: p.status, ...(p.text80mm ? { text80mm: p.text80mm } : {}), ...(p.qrImage ? { qrImage: p.qrImage } : {}) })) } : {}),
    ...(mev.creditNotes?.length ? { creditNotes: mev.creditNotes } : {}),
  };
}

/**
 * The register sale for this Clover order. The device calls right after the payment, often before Clover's webhook
 * arrives: an order not seen yet is read from Clover now (with the device's own token) and recorded.
 */
export async function registerSaleForDevice(merchantId: string, token: string, cloverOrderId: string): Promise<RegisterSale | null | 'not_register'> {
  const id = registerSaleId(merchantId, cloverOrderId);
  const existing = await getRegisterSale(id);
  if (existing?.mev) return existing;
  const { cloverGet, knownFoodHubCloverIds, labelMaps } = await import('../pos/clover-website-orders');
  const r = await cloverGet(merchantId, token, `orders/${encodeURIComponent(cloverOrderId)}`, { expand: 'lineItems,lineItems.modifications,payments,payments.tender,refunds,orderType,discounts' }).catch(() => null);
  if (!r || r.status < 200 || r.status >= 300) return existing;
  const maps = await labelMaps(merchantId, token);
  if (!existing && !isRegisterOrder(r.json, { ...maps, known: await knownFoodHubCloverIds(Date.now()) })) return 'not_register';
  return ingestRegisterOrder(merchantId, r.json, { orderTypes: maps.orderTypes });
}
