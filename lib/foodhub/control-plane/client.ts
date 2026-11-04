import type { ControlPlaneConfig, MerchantBinding } from './config';

export const CONTROL_PLANE_TIMEOUT_MS = 1800;
export const CONTROL_PLANE_BODY_MAX = 16_384;
export interface MerchantObservation { known: boolean; verified: boolean; masterMerchantId?: string; storeName?: string; marketplaceStatus?: string | null; subscriptionStatus?: string | null; subscriptionPlan?: string | null; synchronizedAt?: string; observedAt: string; error?: string; retryAfterMs?: number }
export interface WireEvent { event_id: string; event_type: 'order.created' | 'order.fulfilled'; aggregate_type: 'order'; aggregate_id: string; source_application: 'foodhub'; payload: { local_vendor_id: string; master_merchant_id: string; occurred_at: string; counts: { orders: 1 } } }
export class ControlPlaneError extends Error {
  constructor(public code: string, public permanent = false, public retryAfterMs?: number) { super(code); }
}
const object = (raw: unknown): Record<string, unknown> | null => raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : null;
const optionalText = (v: unknown, max: number): string | null | undefined => v === null ? null : typeof v === 'string' && v.length <= max ? v.replace(/[\u0000-\u001f\u007f]/g, '').trim() : undefined;
const exactKeys = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).length === keys.length && Object.keys(value).every((k) => keys.includes(k));
/** Explicit allowlist: V1 itself rejects credentials but does not prevent arbitrary customer PII in event payloads. */
export function parseWireEvent(raw: string): WireEvent | null {
  if (Buffer.byteLength(raw, 'utf8') > CONTROL_PLANE_BODY_MAX) return null;
  try {
    const e = object(JSON.parse(raw));const p = object(e?.payload);const counts = object(p?.counts);
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!e || !p || !counts || !exactKeys(e, ['event_id', 'event_type', 'aggregate_type', 'aggregate_id', 'source_application', 'payload'])
      || !exactKeys(p, ['local_vendor_id', 'master_merchant_id', 'occurred_at', 'counts']) || !exactKeys(counts, ['orders']) || counts.orders !== 1
      || typeof e.event_id !== 'string' || !uuid.test(e.event_id) || typeof e.aggregate_id !== 'string' || !uuid.test(e.aggregate_id)
      || !['order.created', 'order.fulfilled'].includes(String(e.event_type)) || e.aggregate_type !== 'order' || e.source_application !== 'foodhub'
      || typeof p.local_vendor_id !== 'string' || p.local_vendor_id.length < 1 || p.local_vendor_id.length > 200
      || typeof p.master_merchant_id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(p.master_merchant_id)
      || typeof p.occurred_at !== 'string' || !Number.isFinite(Date.parse(p.occurred_at))) return null;
    return e as unknown as WireEvent;
  } catch { return null; }
}

async function post(config: ControlPlaneConfig, endpoint: string, body: string, eventId?: string, fetcher: typeof fetch = fetch): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetcher(new URL(endpoint, config.url).toString(), { method: 'POST', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(CONTROL_PLANE_TIMEOUT_MS),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}`, ...(eventId ? { 'Idempotency-Key': eventId } : {}) }, body });
  } catch { throw new ControlPlaneError('network_unavailable'); }
  if (!response.ok) {
    const rawRetry = response.headers.get('retry-after');
    const seconds = rawRetry !== null && /^\d+(?:\.\d+)?$/.test(rawRetry.trim()) ? Number(rawRetry) : NaN;
    const retry = Number.isFinite(seconds) ? seconds * 1000 : rawRetry ? Date.parse(rawRetry) - Date.now() : NaN;
    await response.body?.cancel().catch(() => undefined);
    throw new ControlPlaneError(`http_${response.status}`, response.status === 400 || response.status === 409, Number.isFinite(retry) && retry > 0 ? Math.min(retry, 3600_000) : undefined);
  }
  if (!response.body || Number(response.headers.get('content-length') ?? 0) > CONTROL_PLANE_BODY_MAX) { await response.body?.cancel().catch(() => undefined);throw new ControlPlaneError('invalid_response'); }
  const reader = response.body.getReader();const chunks: Uint8Array[] = [];let size = 0;
  try {
    while (true) {
      const next = await reader.read();if (next.done) break;
      size += next.value.byteLength;
      if (size > CONTROL_PLANE_BODY_MAX) { await reader.cancel();throw new ControlPlaneError('response_too_large'); }
      chunks.push(next.value);
    }
  } catch (error) { if (error instanceof ControlPlaneError) throw error;throw new ControlPlaneError('network_unavailable'); }
  finally { reader.releaseLock(); }
  let result: Record<string, unknown> | null;
  try { result = object(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { result = null; }
  if (!result || result.ok !== true) throw new ControlPlaneError('invalid_response');
  return result;
}

/** Actual C4 is source-synchronized merchant metadata. It does not return authorized feature gates or Stripe rights. */
export async function readMerchantObservation(config: ControlPlaneConfig, binding: MerchantBinding, now = Date.now(), fetcher: typeof fetch = fetch): Promise<MerchantObservation> {
  const observedAt = new Date(now).toISOString();
  try {
    const data = await post(config, '/api/v1/merchants/entitlements', JSON.stringify({ source_application: 'foodhub', local_vendor_id: binding.localVendorId }), undefined, fetcher);
    if (data.known === false) return { known: false, verified: false, observedAt };
    if (data.known !== true || typeof data.master_merchant_id !== 'string' || data.master_merchant_id.toLowerCase() !== binding.masterMerchantId) throw new ControlPlaneError('merchant_mismatch', true);
    const name = optionalText(data.store_name, 200);
    const marketplaceStatus = optionalText(data.marketplace_status, 100);
    const subscriptionStatus = optionalText(data.subscription_status, 100);
    const subscriptionPlan = optionalText(data.subscription_plan, 100);
    const sync = typeof data.synchronized_at === 'string' ? Date.parse(data.synchronized_at) : NaN;
    if (typeof name !== 'string' || !name || marketplaceStatus === undefined || subscriptionStatus === undefined || subscriptionPlan === undefined || !Number.isFinite(sync) || sync > now + 300_000) throw new ControlPlaneError('invalid_response');
    return { known: true, verified: true, masterMerchantId: binding.masterMerchantId, storeName: name, marketplaceStatus, subscriptionStatus, subscriptionPlan, synchronizedAt: new Date(sync).toISOString(), observedAt };
  } catch (error) { return { known: false, verified: false, observedAt, error: error instanceof ControlPlaneError ? error.code : 'unavailable', ...(error instanceof ControlPlaneError && error.retryAfterMs ? { retryAfterMs: error.retryAfterMs } : {}) }; }
}

/** Persist and retry these exact bytes: V1 de-duplicates by UUID AND raw-body SHA256. */
export async function deliverWireEvent(config: ControlPlaneConfig, rawBody: string, fetcher: typeof fetch = fetch): Promise<{ duplicate: boolean }> {
  const event = parseWireEvent(rawBody);
  if (!event) throw new ControlPlaneError('invalid_event', true);
  const data = await post(config, '/api/v1/events', rawBody, event.event_id, fetcher);
  if (data.aggregate_type !== 'order' || data.aggregate_id !== event.aggregate_id || typeof data.duplicate !== 'boolean' || typeof data.id !== 'string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(data.id)) throw new ControlPlaneError('event_response_mismatch');
  return { duplicate: data.duplicate };
}
