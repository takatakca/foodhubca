/**
 * BMO Interac Request Money: fail-closed, sandbox-only integration boundary.
 * Contract-specific JSON mapping requires the approved BMO 4.3.1 OpenAPI.
 * No automatic production calls or kitchen release.
 * — signé : GPT-6 (ChatGPT) · 2026-11-01
 */
import { createHash, randomUUID } from 'node:crypto';

export type BmoEnvironment = 'sandbox' | 'preproduction' | 'production';
export type BmoPaymentState = 'completed' | 'rejected' | 'cancelled' | 'processing' | 'unknown';
export interface BmoOrderFingerprint { merchantKey: string; orderId: string; amountCents: number }
export interface BmoStatusObservation {
  messageId: string; orderReference: string; amountCents: number;
  currency: string; statusCode: string; providerPaymentId?: string;
}
export interface BmoTransportConfig {
  environment: BmoEnvironment; baseUrl: string;
  apiKey: string; accessToken: string; timeoutMs?: number;
}
const STATUS: Record<string, BmoPaymentState> = {
  ACCC: 'completed', RJCT: 'rejected', CANC: 'cancelled',
  ACTC: 'processing', ACSP: 'processing', ACSC: 'processing',
};
export function bmoStatus(code: string): BmoPaymentState {
  return STATUS[String(code).trim().toUpperCase()] ?? 'unknown';
}
function nonempty(v: string, label: string): string {
  if (typeof v !== 'string' || !v.trim()) throw new Error(label + ' required');
  return v.trim();
}
export function assertBmoOrder(o: BmoOrderFingerprint): void {
  nonempty(o.merchantKey, 'merchantKey');
  nonempty(o.orderId, 'orderId');
  if (!Number.isSafeInteger(o.amountCents) || o.amountCents <= 0)
    throw new Error('amountCents must be positive integer CAD cents');
}
/** Stable across retries; never change after an unknown-outcome POST. */
export function bmoMessageId(o: BmoOrderFingerprint): string {
  assertBmoOrder(o);
  return 'FH' + createHash('sha256')
    .update(JSON.stringify([o.merchantKey, o.orderId]))
    .digest('hex').slice(0, 33); // 35 characters
}
/** ACCC alone does not suffice: verify original order, merchant-bound ID and exact CAD cents. */
export function bmoMayRelease(
  order: BmoOrderFingerprint, originalMessageId: string, response: BmoStatusObservation,
): boolean {
  assertBmoOrder(order);
  return bmoStatus(response.statusCode) === 'completed'
    && response.messageId === originalMessageId
    && originalMessageId === bmoMessageId(order)
    && response.orderReference === order.orderId
    && response.currency === 'CAD'
    && response.amountCents === order.amountCents
    && Boolean(response.providerPaymentId?.trim());
}
/** Only explicitly approved exact payment hostnames may be delivered by Twilio. */
export function bmoPaymentLink(candidate: string, allowedHostnames: readonly string[]): string {
  if (!allowedHostnames.length) throw new Error('BMO payment hostname allowlist required');
  let url: URL;
  try { url = new URL(candidate); } catch { throw new Error('Invalid BMO payment URL'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash)
    throw new Error('Unsafe BMO payment URL');
  if (!allowedHostnames.some((host) => url.hostname.toLowerCase() === host.toLowerCase()))
    throw new Error('Unapproved BMO payment hostname');
  return url.toString();
}
function safeEndpoint(baseUrl: string, path: string): string {
  const base = new URL(baseUrl);
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash || base.port)
    throw new Error('BMO API base URL must be a clean HTTPS origin');
  if (!path.startsWith('/') || path.startsWith('//') || /[\\?#]/.test(path) || /%2f|%5c|%2e/i.test(path) || path.split('/').some((segment) => segment === '.' || segment === '..'))
    throw new Error('Invalid BMO API endpoint');
  const url = new URL(path, base);
  if (url.origin !== base.origin) throw new Error('Off-origin BMO API URL');
  return url.toString();
}
/**
 * Authenticated transport, NO auto-retry. Paths/payloads must come from the
 * approved BMO schema; OAuth 3-legged token supplied by a separate consent flow.
 */
export async function bmoRequest<T>(
  config: BmoTransportConfig, method: 'GET' | 'POST',
  path: string, payload?: unknown, fetchImpl: typeof fetch = fetch,
): Promise<T> {
  if (config.environment === 'production') throw new Error('Production BMO transport disabled pending rollout approval');
  const url = safeEndpoint(config.baseUrl, path);
  const apiKey = nonempty(config.apiKey, 'BMO API key');
  const token = nonempty(config.accessToken, 'BMO OAuth token');
  if (method === 'GET' && payload !== undefined) throw new Error('GET payload forbidden');
  const timeout = config.timeoutMs ?? 12_000;
  if (!Number.isSafeInteger(timeout) || timeout < 100 || timeout > 30_000) throw new Error('Invalid timeout');
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(timeout),
      headers: {
        Authorization: 'Bearer ' + token, 'x-api-key': apiKey,
        'x-fapi-financial-id': '001',
        'x-fapi-interaction-id': randomUUID(), 'x-request-id': randomUUID(),
        Accept: 'application/json',
        ...(payload === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    });
  } catch {
    throw new Error('BMO outcome uncertain (network/timeout); reconcile before retry');
  }
  if (!response.ok) throw new Error('BMO returned HTTP ' + response.status + '; reconcile before resubmission');
  const value: unknown = await response.json().catch(() => null);
  if (!value || typeof value !== 'object') throw new Error('Invalid BMO JSON response');
  return value as T;
}
